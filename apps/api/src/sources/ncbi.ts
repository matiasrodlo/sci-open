import axios, { AxiosInstance } from 'axios';
import { parseString } from 'xml2js';
import { OARecord, SourceConnector } from '@open-access-explorer/shared';
import { getPooledClient } from '../lib/http-client-factory';
import { getServiceConfig } from '../lib/http-pool-config';

export class NCBIConnector implements SourceConnector {
  private baseUrl: string;
  private apiKey?: string;
  private httpClient: AxiosInstance;

  constructor(baseUrl: string = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils', apiKey?: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    // Initialize pooled HTTP client with NCBI-specific configuration
    this.httpClient = getPooledClient(baseUrl, getServiceConfig('ncbi'));
  }

  async search(params: {
    doi?: string;
    titleOrKeywords?: string;
    yearFrom?: number;
    yearTo?: number;
  }): Promise<OARecord[]> {
    const { doi, titleOrKeywords, yearFrom, yearTo } = params;
    
    console.log('NCBI search called with params:', { doi, titleOrKeywords, yearFrom, yearTo });

    try {
      let query = '';
      
      if (doi) {
        query = `${doi}[DOI]`;
      } else if (titleOrKeywords) {
        query = titleOrKeywords;
      } else {
        console.log('NCBI: No query provided');
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

      // Add open access filter - only return open access articles
      query = `${query} AND "open access"[Filter]`;

      // First, search for PMIDs
      const searchParams: any = {
        db: 'pubmed',
        term: query,
        retmax: 50,
        retmode: 'json',
        usehistory: 'y',
      };

      // Only add API key if it's valid (not empty and not a placeholder)
      if (this.apiKey && this.apiKey !== 'your_ncbi_api_key_here' && this.apiKey.trim() !== '') {
        searchParams.api_key = this.apiKey;
      }

      const searchResponse = await this.httpClient.get('/esearch.fcgi', {
        params: searchParams,
        timeout: 5000
      });

      const searchData = searchResponse.data;
      const pmids = searchData.esearchresult?.idlist || [];
      
      console.log('NCBI search response:', { query, pmids: pmids.length, firstFew: pmids.slice(0, 3) });

      if (pmids.length === 0) {
        console.log('NCBI: No PMIDs found for query:', query);
        return [];
      }

      // Then fetch detailed records
      const fetchParams: any = {
        db: 'pubmed',
        id: pmids.join(','),
        retmode: 'xml',
        rettype: 'abstract',
      };

      // Only add API key if it's valid (not empty and not a placeholder)
      if (this.apiKey && this.apiKey !== 'your_ncbi_api_key_here' && this.apiKey.trim() !== '') {
        fetchParams.api_key = this.apiKey;
      }

      const fetchResponse = await this.httpClient.get('/efetch.fcgi', {
        params: fetchParams,
        timeout: 5000
      });

      return new Promise((resolve, reject) => {
        parseString(fetchResponse.data, (err, result) => {
          if (err) {
            console.error('NCBI XML parsing error:', err);
            reject(err);
            return;
          }

          try {
            const articles = result?.PubmedArticleSet?.PubmedArticle || [];
            console.log('NCBI fetch response:', { articlesCount: articles.length });
            
            const records = articles
              .map((article: any) => this.normalizeArticle(article))
              .filter((record: OARecord | null): record is OARecord => record !== null);
            
            console.log('NCBI normalized records:', { total: records.length, sample: records[0]?.title });
            resolve(records);
          } catch (error) {
            console.error('NCBI normalization error:', error);
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
    
    // PMID extraction completed
    
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

    // Check if it's open access and extract PMC ID
    let oaStatus: 'preprint' | 'accepted' | 'published' | 'other' = 'other';
    let pmcId: string | undefined;
    let bestPdfUrl: string | undefined;
    
    const pubmedData = pubmedArticle.PubmedData?.[0] || pubmedArticle.PubmedData;
    const articleIdList = pubmedData?.ArticleIdList?.[0] || pubmedData?.ArticleIdList;
    const articleIds = articleIdList?.ArticleId || [];
    
    // Extract PMC ID if available
    if (Array.isArray(articleIds)) {
      for (const id of articleIds) {
        const idType = id.$?.IdType || id.IdType;
        if (idType === 'pmc') {
          // Extract the PMC ID value
          let pmcValue: string | undefined;
          if (typeof id === 'string') {
            pmcValue = id;
          } else if (id._) {
            pmcValue = id._;
          } else if (Array.isArray(id) && id.length > 0) {
            pmcValue = id[0]._ || id[0];
          }
          
          if (pmcValue) {
            // PMC IDs can be like "PMC1234567" or just "1234567"
            pmcId = pmcValue.startsWith('PMC') ? pmcValue : `PMC${pmcValue}`;
            oaStatus = 'published';
            // Construct the PDF URL for PMC papers
            bestPdfUrl = `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcId}/pdf/`;
            break;
          }
        }
      }
    }
    
    // If no PMC ID found, this is likely a paywalled paper
    if (!pmcId) {
      oaStatus = 'other'; // Indicates not open access
    }

    // Extract title
    const titleData = article?.ArticleTitle;
    let title: string;
    if (Array.isArray(titleData)) {
      const firstTitle = titleData[0];
      if (typeof firstTitle === 'string') {
        title = firstTitle;
      } else if (firstTitle?._) {
        title = firstTitle._;
      } else if (firstTitle) {
        title = String(firstTitle);
      } else {
        title = '';
      }
    } else if (typeof titleData === 'string') {
      title = titleData;
    } else if (titleData?._) {
      title = titleData._;
    } else if (titleData) {
      title = String(titleData);
    } else {
      title = '';
    }
    
    // Ensure title is a clean string
    if (title === '[object Object]' || title === 'undefined' || title === 'null') {
      title = '';
    }

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

    // Skip papers with empty or invalid titles
    if (!title || title.trim() === '') {
      console.log('NCBI: Skipping paper with empty title, PMID:', pmid);
      return null;
    }

    const record = {
      id: `ncbi:${pmid}`,
      title: title.trim(),
      authors,
      year,
      venue,
      abstract,
      source: 'ncbi',
      sourceId: pmid || '',
      oaStatus,
      bestPdfUrl, // Only set if PMC ID was found
      landingPage: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      topics: [],
      language,
      createdAt: new Date().toISOString(),
    };
    
    console.log('NCBI: Normalized record:', { pmid, title: title.substring(0, 50), hasAbstract: !!abstract, venue });
    
    return record;
  }
}
