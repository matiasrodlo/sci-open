import axios from 'axios';

/**
 * Unpaywall API Integration
 * Provides free PDF links for papers with DOIs
 * API Docs: https://unpaywall.org/products/api
 */

interface UnpaywallResponse {
  doi: string;
  doi_url: string;
  is_oa: boolean;
  best_oa_location?: {
    url: string;
    url_for_pdf?: string;
    url_for_landing_page?: string;
    version?: string;
    license?: string;
  };
  oa_locations?: Array<{
    url: string;
    url_for_pdf?: string;
    url_for_landing_page?: string;
    version?: string;
    license?: string;
  }>;
}

export class UnpaywallConnector {
  private baseUrl: string;
  private email: string;

  constructor(email: string = 'your-email@example.com') {
    this.baseUrl = 'https://api.unpaywall.org/v2';
    this.email = email;
  }

  /**
   * Get PDF URL for a paper by DOI
   */
  async getPdfByDoi(doi: string): Promise<string | null> {
    if (!doi) return null;

    try {
      const response = await axios.get<UnpaywallResponse>(
        `${this.baseUrl}/${encodeURIComponent(doi)}`,
        {
          params: {
            email: this.email,
          },
          timeout: 5000,
        }
      );

      const data = response.data;

      // Check if it's open access
      if (!data.is_oa) {
        return null;
      }

      // Try to get PDF from best OA location
      if (data.best_oa_location?.url_for_pdf) {
        return data.best_oa_location.url_for_pdf;
      }

      // Try to get PDF from any OA location
      if (data.oa_locations && data.oa_locations.length > 0) {
        for (const location of data.oa_locations) {
          if (location.url_for_pdf) {
            return location.url_for_pdf;
          }
        }
      }

      // Fallback to landing page if no direct PDF
      if (data.best_oa_location?.url_for_landing_page) {
        return data.best_oa_location.url_for_landing_page;
      }

      return null;
    } catch (error: any) {
      // 404 means paper not found in Unpaywall (not an error)
      if (error.response?.status === 404) {
        return null;
      }
      console.error('Unpaywall API error:', error.message);
      return null;
    }
  }

  /**
   * Get detailed OA information for a paper
   */
  async getOaInfo(doi: string): Promise<UnpaywallResponse | null> {
    if (!doi) return null;

    try {
      const response = await axios.get<UnpaywallResponse>(
        `${this.baseUrl}/${encodeURIComponent(doi)}`,
        {
          params: {
            email: this.email,
          },
          timeout: 5000,
        }
      );

      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      console.error('Unpaywall API error:', error.message);
      return null;
    }
  }
}


