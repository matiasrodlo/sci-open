import axios, { AxiosInstance } from 'axios';
import { parseString } from 'xml2js';
import { OARecord, SourceConnector, SourceSearchParams, SourceSearchResult } from '@open-access-explorer/shared';
import { getPooledClient } from '../lib/http-client-factory';
import { getServiceConfig } from '../lib/http-pool-config';
import { log } from '../lib/logger';

// Keep a single efetch payload manageable; PubMed abstract XML is bulky
const MAX_PAGE_SIZE = 500;

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

  async search(params: SourceSearchParams): Promise<SourceSearchResult> {
    const { doi, titleOrKeywords, yearFrom, yearTo, limit = 50, offset = 0 } = params;
    
    log.debug('NCBI search called with params:', { doi, titleOrKeywords, yearFrom, yearTo });

    try {
      let query = '';
      
      if (doi) {
        query = `${doi}[DOI]`;
      } else if (titleOrKeywords) {
        query = titleOrKeywords;
      } else {
        log.debug('NCBI: No query provided');
        return { records: [] };
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

      // Restrict to open access. PubMed has no "open access"[Filter]; quoting an
      // unknown filter makes it a literal phrase that matches nothing, so the
      // whole query silently returned zero. This is the real subset name.
      query = `${query} AND pubmed pmc open access[filter]`;

      // First, search for PMIDs
      const searchParams: any = {
        db: 'pubmed',
        term: query,
        retmax: Math.min(Math.max(limit, 1), MAX_PAGE_SIZE),
        retstart: Math.max(offset, 0),
        retmode: 'json',
        usehistory: 'y',
      };

      // Only add API key if it's valid (not empty and not a placeholder)
      if (this.apiKey && this.apiKey !== 'your_ncbi_api_key_here' && this.apiKey.trim() !== '') {
        searchParams.api_key = this.apiKey;
      }

      const searchResponse = await this.httpClient.get('/esearch.fcgi', {
        params: searchParams,
        timeout: Math.min(10000 + searchParams.retmax * 20, 40000)
      });

      const searchData = searchResponse.data;
      const pmids = searchData.esearchresult?.idlist || [];
      const reportedCount = Number(searchData.esearchresult?.count);
      const totalHits = Number.isFinite(reportedCount) ? reportedCount : undefined;
      
      log.debug('NCBI search response:', { query, pmids: pmids.length, firstFew: pmids.slice(0, 3) });

      if (pmids.length === 0) {
        return { records: [], totalHits };
      }

      // Then fetch detailed records. The id list goes in a POST body: a few
      // hundred PMIDs overflow the URI length limit, and NCBI answers an
      // oversized GET with 414 — which the pooled client does not treat as an
      // error, so the failure surfaced only as zero results.
      const fetchBody = new URLSearchParams({
        db: 'pubmed',
        id: pmids.join(','),
        retmode: 'xml',
        rettype: 'abstract',
      });

      // Only add API key if it's valid (not empty and not a placeholder)
      if (this.apiKey && this.apiKey !== 'your_ncbi_api_key_here' && this.apiKey.trim() !== '') {
        fetchBody.set('api_key', this.apiKey);
      }

      const fetchResponse = await this.httpClient.post('/efetch.fcgi', fetchBody.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        // Abstract XML for a few hundred PMIDs is large, so the budget scales
        // with how many were asked for rather than sitting at a flat 5s
        timeout: Math.min(10000 + pmids.length * 60, 45000)
      });

      return new Promise((resolve, reject) => {
        parseString(fetchResponse.data, (err, result) => {
          if (err) {
            log.error('NCBI XML parsing error:', err);
            reject(err);
            return;
          }

          try {
            const articles = result?.PubmedArticleSet?.PubmedArticle || [];
            log.debug('NCBI fetch response:', { articlesCount: articles.length });
            
            const records = articles
              .map((article: any) => this.normalizeArticle(article))
              .filter((record: OARecord | null): record is OARecord => record !== null);
            
            resolve({ records, totalHits });
          } catch (error) {
            log.error('NCBI normalization error:', error);
            reject(error);
          }
        });
      });
    } catch (error) {
      log.error('NCBI search error:', error);
      return { records: [] };
    }
  }

  private normalizeArticle(pubmedArticle: any): OARecord | null {
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
      return null;
    }

    const record: OARecord = {
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
    
    
    return record;
  }
}
