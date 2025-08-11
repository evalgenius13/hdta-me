// api/extract-content.js - Phase 2: Extract full article content
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL required' });
    }

    const extractor = new ArticleContentExtractor();
    const content = await extractor.extractContent(url);
    
    res.json({
      success: true,
      content: content,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      fallback: 'Using headline and description only'
    });
  }
}

class ArticleContentExtractor {
  constructor() {
    this.timeout = 8000; // 8 second timeout for Vercel
    this.maxContentLength = 5000; // Limit for OpenAI processing
  }

  async extractContent(url) {
    // Try multiple extraction strategies
    const strategies = [
      () => this.extractViaReadability(url),
      () => this.extractViaMetaTags(url),
      () => this.extractViaSimpleHTML(url)
    ];

    for (const strategy of strategies) {
      try {
        const result = await strategy();
        if (result && result.content && result.content.length > 200) {
          return result;
        }
      } catch (error) {
        console.warn('Extraction strategy failed:', error.message);
        continue;
      }
    }

    throw new Error('All content extraction strategies failed');
  }

  async extractViaReadability(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      const content = this.parseContentWithReadability(html, url);
      
      return {
        ...content,
        extractionMethod: 'readability',
        url: url
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  parseContentWithReadability(html, url) {
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i) ||
                      html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    const title = titleMatch ? this.cleanText(titleMatch[1]) : '';

    // Look for article content using common patterns
    const contentSelectors = [
      // News site patterns
      /<article[^>]*>(.*?)<\/article>/is,
      /<div[^>]*class="[^"]*article[^"]*"[^>]*>(.*?)<\/div>/is,
      /<div[^>]*class="[^"]*story[^"]*"[^>]*>(.*?)<\/div>/is,
      /<div[^>]*class="[^"]*content[^"]*"[^>]*>(.*?)<\/div>/is,
      /<main[^>]*>(.*?)<\/main>/is,
      
      // Fallback to body content
      /<body[^>]*>(.*?)<\/body>/is
    ];

    let rawContent = '';
    for (const pattern of contentSelectors) {
      const match = html.match(pattern);
      if (match) {
        rawContent = match[1];
        break;
      }
    }

    // Extract meaningful paragraphs
    const paragraphs = this.extractParagraphs(rawContent);
    const content = paragraphs.join('\n\n');

    // Get meta description as backup
    const metaDesc = this.extractMetaDescription(html);

    return {
      title: title,
      content: content || metaDesc,
      wordCount: content.split(/\s+/).length,
      paragraphCount: paragraphs.length
    };
  }

  extractParagraphs(html) {
    if (!html) return [];

    // Remove unwanted elements
    let cleaned = html
      .replace(/<script[^>]*>.*?<\/script>/gis, '')
      .replace(/<style[^>]*>.*?<\/style>/gis, '')
      .replace(/<nav[^>]*>.*?<\/nav>/gis, '')
      .replace(/<footer[^>]*>.*?<\/footer>/gis, '')
      .replace(/<aside[^>]*>.*?<\/aside>/gis, '')
      .replace(/<header[^>]*>.*?<\/header>/gis, '')
      .replace(/<form[^>]*>.*?<\/form>/gis, '')
      .replace(/<!--.*?-->/gs, '');

    // Extract paragraphs
    const paragraphMatches = cleaned.match(/<p[^>]*>([^<]+(?:<[^p][^>]*>[^<]*<\/[^p][^>]*>[^<]*)*)<\/p>/gi) || [];
    
    const paragraphs = paragraphMatches
      .map(p => this.cleanText(p.replace(/<[^>]+>/g, ' ')))
      .filter(p => p.length > 50) // Filter out short paragraphs
      .filter(p => this.isContentParagraph(p))
      .slice(0, 10); // Take first 10 meaningful paragraphs

    return paragraphs;
  }

  isContentParagraph(text) {
    // Filter out common non-content patterns
    const skipPatterns = [
      /^(subscribe|sign up|follow us|share this|related|see also)/i,
      /^(copyright|all rights reserved|\d{4})/i,
      /^(click here|read more|continue reading)/i,
      /(advertisement|sponsored|promoted)/i,
      /^.{0,20}$/ // Too short
    ];

    return !skipPatterns.some(pattern => pattern.test(text));
  }

  async extractViaMetaTags(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)',
          'Accept': 'text/html'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const html = await response.text();
      
      // Extract meta tags
      const title = this.extractMetaContent(html, 'og:title') || 
                   this.extractMetaContent(html, 'title') ||
                   html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '';

      const description = this.extractMetaContent(html, 'og:description') ||
                         this.extractMetaContent(html, 'description') || '';

      return {
        title: this.cleanText(title),
        content: this.cleanText(description),
        wordCount: description.split(/\s+/).length,
        extractionMethod: 'meta_tags',
        url: url
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async extractViaSimpleHTML(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; PolicyBot/1.0)'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const html = await response.text();
      
      // Simple text extraction
      const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '';
      
      // Remove all HTML and extract text
      const bodyMatch = html.match(/<body[^>]*>(.*?)<\/body>/is);
      let content = bodyMatch ? bodyMatch[1] : html;
      
      // Clean HTML tags
      content = content
        .replace(/<script[^>]*>.*?<\/script>/gis, '')
        .replace(/<style[^>]*>.*?<\/style>/gis, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Take first reasonable chunk
      const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20);
      const limitedContent = sentences.slice(0, 15).join('. ') + '.';

      return {
        title: this.cleanText(title),
        content: limitedContent.substring(0, this.maxContentLength),
        wordCount: limitedContent.split(/\s+/).length,
        extractionMethod: 'simple_html',
        url: url
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  extractMetaContent(html, property) {
    const patterns = [
      new RegExp(`<meta[^>]+property="og:${property}"[^>]+content="([^"]+)"`, 'i'),
      new RegExp(`<meta[^>]+name="${property}"[^>]+content="([^"]+)"`, 'i'),
      new RegExp(`<meta[^>]+content="([^"]+)"[^>]+property="og:${property}"`, 'i'),
      new RegExp(`<meta[^>]+content="([^"]+)"[^>]+name="${property}"`, 'i')
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  extractMetaDescription(html) {
    return this.extractMetaContent(html, 'description') || 
           this.extractMetaContent(html, 'og:description') || '';
  }

  cleanText(text) {
    if (!text) return '';
    
    return text
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }
}

// Test function for development
export async function testContentExtraction(url) {
  const extractor = new ArticleContentExtractor();
  try {
    const result = await extractor.extractContent(url);
    console.log(`✅ Extracted from ${url}:`);
    console.log(`Title: ${result.title.substring(0, 60)}...`);
    console.log(`Content: ${result.content.substring(0, 200)}...`);
    console.log(`Method: ${result.extractionMethod}, Words: ${result.wordCount}`);
    return { success: true, wordCount: result.wordCount };
  } catch (error) {
    console.error(`❌ Failed to extract from ${url}:`, error.message);
    return { success: false, error: error.message };
  }
}
