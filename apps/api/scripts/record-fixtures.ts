/**
 * Records one live response per provider into `src/sources/__fixtures__/`.
 *
 * Run it deliberately, not on every test run — the whole point of committing
 * the output is that the normaliser suites never touch the network. Re-record
 * only when a provider changes its response shape, and expect the diff to be
 * reviewed: a fixture is the contract those tests assert against.
 *
 *   pnpm --filter @open-access-explorer/api exec tsx scripts/record-fixtures.ts
 *
 * Responses are trimmed to a handful of records. They exist to pin field
 * mapping, not to be a corpus.
 */
import axios from 'axios';
import fs from 'fs';
import path from 'path';

const QUERY = 'crispr gene editing';
const OUT = path.resolve(__dirname, '../src/sources/__fixtures__');
const UA = `OpenAccessExplorer/1.0 (mailto:${process.env.UNPAYWALL_EMAIL || 'fixtures@example.com'})`;

function write(name: string, data: unknown) {
  const file = path.join(OUT, name);
  const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n';
  fs.writeFileSync(file, body);
  console.log(`${name.padEnd(28)} ${(Buffer.byteLength(body) / 1024).toFixed(1)} KB`);
}

async function record(name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (error: any) {
    console.error(`${name.padEnd(28)} FAILED: ${error.response?.status ?? ''} ${error.message}`);
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  await record('europepmc', async () => {
    const r = await axios.get('https://www.ebi.ac.uk/europepmc/webservices/rest/search', {
      params: { query: `${QUERY} AND OPEN_ACCESS:y`, format: 'json', pageSize: 3, resultType: 'core' },
      headers: { 'User-Agent': UA }, timeout: 30000
    });
    write('europepmc.json', { ...r.data, resultList: { result: r.data.resultList.result.slice(0, 3) } });
  });

  await record('arxiv', async () => {
    const r = await axios.get('https://export.arxiv.org/api/query', {
      params: { search_query: 'all:crispr', start: 0, max_results: 3, sortBy: 'relevance' },
      headers: { 'User-Agent': UA }, responseType: 'text', timeout: 30000
    });
    write('arxiv.xml', r.data);
  });

  await record('ncbi', async () => {
    const s = await axios.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi', {
      params: { db: 'pubmed', term: `${QUERY} AND pubmed pmc open access[filter]`, retmax: 3, retmode: 'json' },
      headers: { 'User-Agent': UA }, timeout: 30000
    });
    const pmids = s.data.esearchresult.idlist;
    write('ncbi-esearch.json', s.data);
    const f = await axios.post(
      'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi',
      new URLSearchParams({ db: 'pubmed', id: pmids.join(','), retmode: 'xml', rettype: 'abstract' }).toString(),
      { headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, responseType: 'text', timeout: 30000 }
    );
    write('ncbi-efetch.xml', f.data);
  });

  await record('doaj', async () => {
    const r = await axios.get(`https://doaj.org/api/search/articles/${encodeURIComponent(`title:${QUERY}`)}`, {
      params: { pageSize: 3, page: 1 }, headers: { 'User-Agent': UA }, timeout: 30000
    });
    write('doaj.json', { ...r.data, results: (r.data.results || []).slice(0, 3) });
  });

  await record('plos', async () => {
    const r = await axios.get('https://api.plos.org/search', {
      params: {
        q: `everything:${QUERY}`, rows: 3, start: 0, wt: 'json',
        fl: 'id,title,title_display,author,author_display,abstract,publication_date,journal,article_type,doi,score',
        fq: 'doc_type:full AND article_type:"Research Article"'
      },
      headers: { 'User-Agent': UA }, timeout: 30000
    });
    write('plos.json', { ...r.data, response: { ...r.data.response, docs: r.data.response.docs.slice(0, 3) } });
  });

  await record('openaire', async () => {
    const r = await axios.get('https://api.openaire.eu/search/publications', {
      params: { keywords: QUERY, format: 'json', size: 3, page: 1, OA: 'true' },
      headers: { 'User-Agent': UA }, timeout: 30000
    });
    const results = r.data?.response?.results?.result;
    write('openaire.json', {
      response: { ...r.data.response, results: { result: (Array.isArray(results) ? results : [results]).slice(0, 3) } }
    });
  });

  await record('datacite', async () => {
    const r = await axios.get('https://api.datacite.org/dois', {
      params: { 'page[size]': 3, 'page[number]': 1, query: `titles.title:*${QUERY}*` },
      headers: { 'User-Agent': UA }, timeout: 30000
    });
    write('datacite.json', { ...r.data, data: r.data.data.slice(0, 3) });
  });

  await record('biorxiv', async () => {
    const end = new Date().toISOString().split('T')[0];
    const start = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const r = await axios.get(`https://api.biorxiv.org/details/biorxiv/${start}/${end}`, {
      params: { cursor: 0, format: 'json' }, headers: { 'User-Agent': UA }, timeout: 30000
    });
    write('biorxiv.json', { ...r.data, collection: (r.data.collection || []).slice(0, 3) });
  });

  await record('core', async () => {
    const key = process.env.CORE_API_KEY;
    if (!key || key.includes('your_')) {
      console.log('core'.padEnd(28) + 'SKIPPED: CORE_API_KEY not set');
      return;
    }
    const r = await axios.get('https://api.core.ac.uk/v3/search/works', {
      params: { q: QUERY, limit: 3 },
      headers: { 'User-Agent': UA, Authorization: `Bearer ${key}` }, timeout: 30000
    });
    write('core.json', { ...r.data, results: r.data.results.slice(0, 3) });
  });
}

main();
