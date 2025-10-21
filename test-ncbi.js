const axios = require('axios');
const { parseString } = require('xml2js');

async function testNCBI() {
  try {
    console.log('Testing NCBI connector...');
    
    // Test search
    const searchResponse = await axios.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi', {
      params: {
        db: 'pubmed',
        term: 'machine learning',
        retmax: 5,
        retmode: 'json'
      },
      timeout: 5000
    });
    
    const searchData = searchResponse.data;
    const pmids = searchData.esearchresult?.idlist || [];
    console.log('PMID search results:', pmids);
    
    if (pmids.length === 0) {
      console.log('No PMIDs found');
      return;
    }
    
    // Test fetch
    const fetchResponse = await axios.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi', {
      params: {
        db: 'pubmed',
        id: pmids.slice(0, 2).join(','),
        retmode: 'xml',
        rettype: 'abstract'
      },
      timeout: 5000
    });
    
    console.log('Fetch response length:', fetchResponse.data.length);
    
    // Test XML parsing
    parseString(fetchResponse.data, (err, result) => {
      if (err) {
        console.error('XML parsing error:', err);
        return;
      }
      
      const articles = result?.PubmedArticleSet?.PubmedArticle || [];
      console.log('Parsed articles count:', articles.length);
      
      if (articles.length > 0) {
        console.log('First article structure:', Object.keys(articles[0]));
      }
    });
    
  } catch (error) {
    console.error('Test error:', error.message);
  }
}

testNCBI();
