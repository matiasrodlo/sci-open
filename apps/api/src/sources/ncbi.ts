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

  private normalizeArticle(article: any): OARecord {
    const medlineCitation = article.MedlineCitation;
    // Extract PMID from the XML structure: <PMID Version="1">41109958</PMID>
    const pmid = medlineCitation.PMID?.[0] || medlineCitation.PMID;
    
    // Debug: log PMID extraction
    console.log('PMID extraction:', { pmid, pmidStructure: medlineCitation.PMID });
    
    // Extract authors
    const authors = [];
    if (medlineCitation.Article?.AuthorList?.Author) {
      const authorList = Array.isArray(medlineCitation.Article.AuthorList.Author) 
        ? medlineCitation.Article.AuthorList.Author 
        : [medlineCitation.Article.AuthorList.Author];
      
      authors.push(...authorList.map((author: any) => {
        const lastName = author.LastName || '';
        const foreName = author.ForeName || '';
        const initials = author.Initials || '';
        return `${lastName} ${foreName || initials}`.trim();
      }));
    }

    // Extract publication date
    const pubDate = medlineCitation.Article?.Journal?.JournalIssue?.PubDate;
    let year: number | undefined;
    if (pubDate?.Year) {
      year = parseInt(pubDate.Year);
    }

    // Check if it's open access (simplified check)
    let oaStatus: 'preprint' | 'accepted' | 'published' | 'other' = 'other';
    const articleIds = medlineCitation.PubmedData?.ArticleIdList?.ArticleId || [];
    const hasPMC = articleIds.some((id: any) => id.$.IdType === 'pmc');
    if (hasPMC) {
      oaStatus = 'published';
    }

    return {
      id: `ncbi:${pmid}`,
      title: medlineCitation.Article?.ArticleTitle || '',
      authors,
      year,
      venue: medlineCitation.Article?.Journal?.Title,
      abstract: medlineCitation.Article?.Abstract?.AbstractText?.['#text'] || 
                medlineCitation.Article?.Abstract?.AbstractText,
      source: 'ncbi',
      sourceId: pmid?.toString() || '',
      oaStatus,
      topics: medlineCitation.MeshHeadingList?.MeshHeading?.map((heading: any) => 
        heading.DescriptorName?.['#text'] || heading.DescriptorName
      ) || [],
      language: medlineCitation.Article?.Language?.[0] || 'en',
      createdAt: new Date().toISOString(),
    };
  }
}
