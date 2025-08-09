// js/news-manager.js - Auto narrative analysis, no button
class NewsManager {
  constructor() {
    this.articles = [];
    this.loading = false;
    this.lastFetchTime = null;
  }

  async fetchNews() {
    if (this.loading) return;

    try {
      this.setLoading(true);
      this.lastFetchTime = Date.now();

      const response = await fetch('/api/fetch-news');
      const data = await response.json();

      if (data.articles) {
        this.articles = data.articles.filter(
          a => a.title && a.description && !a.title.includes('[Removed]')
        );
        await this.displayNews();

        // Auto-load analysis for each article, staggered slightly
        for (let i = 0; i < this.articles.length; i++) {
          // small delay to avoid burst
          setTimeout(() => this.getAnalysis(i), 300 * i);
        }
      } else {
        this.showError(data.error || 'Unable to load news. Please try again later.');
      }
    } catch (error) {
      console.error('Error fetching news:', error);
      this.showError('Unable to load news. Please check your connection.');
    } finally {
      this.setLoading(false);
    }
  }

  async displayNews() {
    const newsGrid = document.getElementById('news-grid');
    if (!newsGrid) return;

    newsGrid.innerHTML = this.articles.map((article, idx) => this.createArticleHTML(article, idx)).join('');
  }

  async getAnalysis(articleIndex) {
    const article = this.articles[articleIndex];
    const impactElement = document.getElementById(`impact-${articleIndex}`);

    if (!article || !impactElement) return;
    if (article._analysisLoaded) return;

    impactElement.innerHTML = '<div class="impact-loading">Analyzing the real impact...</div>';

    try {
      const response = await fetch('/api/personalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          article: {
            title: article.title,
            description: article.description,
            publishedAt: article.publishedAt || null,
            sourceName: article.source?.name || null,
            forceRefresh: true
          }
        })
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();

      if (data && data.impact) {
        // Expect server to return narrative paragraphs. Render as HTML.
        impactElement.innerHTML = data.impact;
        article._analysisLoaded = true;
      } else {
        throw new Error('No analysis returned');
      }
    } catch (error) {
      console.error('Error generating analysis:', error);
      impactElement.innerHTML = '<div class="impact-error">Analysis unavailable right now.</div>';
    }
  }

  createArticleHTML(article, index) {
    // time ago
    let timeAgo = '';
    if (article.publishedAt) {
      const publishTime = new Date(article.publishedAt);
      const now = new Date();
      const diffHours = Math.floor((now - publishTime) / (1000 * 60 * 60));
      if (diffHours < 1) timeAgo = 'Just now';
      else if (diffHours < 24) timeAgo = `${diffHours}h ago`;
      else {
        const diffDays = Math.floor(diffHours / 24);
        timeAgo = `${diffDays}d ago`;
      }
    }

    return `
      <article class="news-card" onclick="window.open('${article.url}', '_blank')" style="cursor:pointer;">
        <div class="news-image">
          ${
            article.image || article.urlToImage
              ? `<img src="${article.image || article.urlToImage}" alt="News image" onerror="this.parentElement.innerHTML='[Image unavailable]'">`
              : '[News Image]'
          }
        </div>
        <div class="news-content">
          <div class="news-meta">
            <span class="news-source">${this.escapeHtml(article.source?.name || 'Unknown Source')}</span>
            ${timeAgo ? `<span class="news-time">${timeAgo}</span>` : ''}
          </div>
          <h2 class="news-title">${this.escapeHtml(article.title)}</h2>
          <p class="news-summary">${this.escapeHtml(article.description)}</p>

          <div class="impact-section">
            <div class="impact-text" id="impact-${index}"></div>
          </div>
        </div>
      </article>
    `;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  setLoading(loading) {
    this.loading = loading;
    const loadingElement = document.getElementById('loading');
    const newsGrid = document.getElementById('news-grid');

    if (loadingElement && newsGrid) {
      loadingElement.innerHTML = loading
        ? '<div>Loading latest news...</div>'
        : '<div>Loading latest news...</div>';
      loadingElement.style.display = loading ? 'block' : 'none';
      newsGrid.style.display = loading ? 'none' : 'grid';
    }
  }

  showError(message) {
    const newsGrid = document.getElementById('news-grid');
    if (newsGrid) {
      newsGrid.innerHTML = `
        <div class="error-state">
          <strong>Error:</strong> ${this.escapeHtml(message)}
          <br><br>
          <button onclick="window.newsManager.fetchNews()" class="compare-btn">Try Again</button>
        </div>
      `;
    }
  }

  refresh() {
    this.articles = [];
    this.fetchNews();
  }
}

// Initialize news manager when DOM is loaded
if (typeof window !== 'undefined') {
  window.newsManager = null;
}
