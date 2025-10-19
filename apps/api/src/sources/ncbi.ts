import axios from 'axios';
import { parseString } from 'xml2js';
import { OARecord, SourceConnector } from '@open-access-explorer/shared';

export class NCBIConnector implements SourceConnector {
  private baseUrl: string;
  private apiKey?: string;

  constructor(baseUrl: string = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils', apiKey?: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async search(params: {
    doi?: string;
    titleOrKeywords?: string;
    yearFrom?: number;
    yearTo?: number;
  }): Promise<OARecord[]> {
    const { doi, titleOrKeywords, yearFrom, yearTo } = params;

    try {
      let query = '';
      
      if (doi) {
        query = `${doi}[DOI]`;
      } else if (titleOrKeywords) {
        query = titleOrKeywords;
      } else {
        return [];
      }

      // Add year filter if provided
      if (yearFrom || yearTo) {
        const yearFilter = [];
        if (yearFrom) yearFilter.push(`${yearFrom}:3000[PDAT]`);
        if (yearTo) yearFilter.push(`1800:${yearTo}[PDAT]`);
        if (yearFilter.length > 0) {
          query = `${query} AND (${yearFilter.join(' AND ')})`;
        }
      }

      // First, search for PMIDs
      const searchParams: any = {
        db: 'pubmed',
        term: query,
        retmax: 50,
        retmode: 'json',
        usehistory: 'y',
      };

      if (this.apiKey) {
        searchParams.api_key = this.apiKey;
      }

      const searchResponse = await axios.get(`${this.baseUrl}/esearch.fcgi`, {
        params: searchParams,
        timeout: 5000
      });

      const searchData = searchResponse.data;
      const pmids = searchData.esearchresult?.idlist || [];

      if (pmids.length === 0) {
        return [];
      }

      // Then fetch detailed records
      const fetchParams: any = {
        db: 'pubmed',
        id: pmids.join(','),
        retmode: 'xml',
        rettype: 'abstract',
      };

      if (this.apiKey) {
        fetchParams.api_key = this.apiKey;
      }

      const fetchResponse = await axios.get(`${this.baseUrl}/efetch.fcgi`, {
        params: fetchParams,
        timeout: 5000
      });

      return new Promise((resolve, reject) => {
        parseString(fetchResponse.data, (err, result) => {
          if (err) {
            reject(err);
            return;
          }

          try {
            const articles = result?.PubmedArticleSet?.PubmedArticle || [];
            const records = articles.map((article: any) => this.normalizeArticle(article));
            resolve(records);
          } catch (error) {
            reject(error);
          }
        });
      });
    } catch (error) {
      console.error('NCBI search error:', error);
      return [];
    }
  }

  private normalizeArticle(pubmedArticle: any): OARecord {
    const medlineCitation = pubmedArticle.MedlineCitation?.[0] || pubmedArticle.MedlineCitation;
    
    // Extract PMID from the XML structure: <PMID Version="1">41109958</PMID>
    // xml2js can parse it as: { _: '41109958', $: { Version: '1' } } or ['41109958'] or '41109958'
    let pmid: string | undefined;
    const pmidData = medlineCitation?.PMID;
    
    if (Array.isArray(pmidData)) {
      // If it's an array, get the first element
      const first = pmidData[0];
      if (typeof first === 'string') {
        pmid = first;
      } else if (first?._ ) {
        pmid = first._;
      } else if (first) {
        pmid = String(first);
      }
    } else if (typeof pmidData === 'string') {
      pmid = pmidData;
    } else if (pmidData?._) {
      // If it's an object with underscore property
      pmid = pmidData._;
    } else if (pmidData) {
      pmid = String(pmidData);
    }
    
    // Debug: log PMID extraction
    console.log('PMID extraction:', { pmid, pmidStructure: medlineCitation?.PMID });
    
    // Extract authors
    const authors = [];
    const article = medlineCitation?.Article?.[0] || medlineCitation?.Article;
    if (article?.AuthorList) {
      const authorListData = article.AuthorList[0] || article.AuthorList;
      const authorArray = authorListData?.Author;
      
      if (authorArray) {
        const authorList = Array.isArray(authorArray) ? authorArray : [authorArray];
        
        authors.push(...authorList.map((author: any) => {
          const lastName = author.LastName?.[0] || author.LastName || '';
          const foreName = author.ForeName?.[0] || author.ForeName || '';
          const initials = author.Initials?.[0] || author.Initials || '';
          return `${lastName} ${foreName || initials}`.trim();
        }));
      }
    }

    // Extract publication date
    const journal = article?.Journal?.[0] || article?.Journal;
    const journalIssue = journal?.JournalIssue?.[0] || journal?.JournalIssue;
    const pubDate = journalIssue?.PubDate?.[0] || journalIssue?.PubDate;
    let year: number | undefined;
    if (pubDate?.Year) {
      const yearValue = Array.isArray(pubDate.Year) ? pubDate.Year[0] : pubDate.Year;
      year = parseInt(yearValue);
    }

    // Check if it's open access (simplified check)
    let oaStatus: 'preprint' | 'accepted' | 'published' | 'other' = 'other';
    const pubmedData = article.PubmedData?.[0] || article.PubmedData;
    const articleIdList = pubmedData?.ArticleIdList?.[0] || pubmedData?.ArticleIdList;
    const articleIds = articleIdList?.ArticleId || [];
    const hasPMC = Array.isArray(articleIds) && articleIds.some((id: any) => {
      const idType = id.$?.IdType || id.IdType;
      return idType === 'pmc';
    });
    if (hasPMC) {
      oaStatus = 'published';
    }

    // Extract title
    const titleData = article?.ArticleTitle;
    const title = Array.isArray(titleData) ? titleData[0] : titleData || '';

    // Extract abstract
    const abstractData = article?.Abstract?.[0] || article?.Abstract;
    const abstractText = abstractData?.AbstractText;
    let abstract: string | undefined;
    if (Array.isArray(abstractText)) {
      abstract = abstractText.map((text: any) => 
        typeof text === 'string' ? text : (text?._ || text?.['#text'] || text)
      ).join(' ');
    } else if (typeof abstractText === 'string') {
      abstract = abstractText;
    } else if (abstractText) {
      abstract = abstractText._ || abstractText['#text'] || String(abstractText);
    }

    // Extract venue (journal title)
    const journalTitle = journal?.Title;
    const venue = Array.isArray(journalTitle) ? journalTitle[0] : journalTitle;

    // Extract language
    const languageData = article?.Language;
    const language = Array.isArray(languageData) ? languageData[0] : (languageData || 'en');

    return {
      id: `ncbi:${pmid}`,
      title: typeof title === 'string' ? title : String(title || ''),
      authors,
      year,
      venue,
      abstract,
      source: 'ncbi',
      sourceId: pmid || '',
      oaStatus,
      topics: [],
      language,
      createdAt: new Date().toISOString(),
    };
  }
}
