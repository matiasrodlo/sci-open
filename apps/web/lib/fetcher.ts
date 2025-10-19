import axios from 'axios';
import { SearchParams, SearchResponse, PaperResponse } from '@open-access-explorer/shared';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';

export async function searchPapers(params: SearchParams): Promise<SearchResponse> {
  const response = await axios.post(`${API_BASE}/api/search`, params);
  return response.data;
}

export async function getPaper(id: string): Promise<PaperResponse> {
  const response = await axios.get(`${API_BASE}/api/paper/${id}`);
  return response.data;
}

export function isDOI(query: string): boolean {
  // Simple DOI pattern matching
  const doiPattern = /^10\.\d{4,}\/[^\s]+$/i;
  return doiPattern.test(query.trim());
}
