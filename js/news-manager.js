// js/news-manager.js
class NewsManager {
  constructor() {
    this.articles = [];
    this.loading = false;
    this.lastFetchTime = null;
    this._origDisplay = null;
  }

  async fetchNews() {
    if (this.loading) return;

    try {
      this.setLoading(true);
      this.lastFetchTime = Date.now();

      const r = await fetch('/api/fetch-news');
      const data = await r.json();
      if (!data.articles) throw new Error('No articles');

      this.articles = data.articles.filter(a => a.title && a.description);
      this.displayNews();
    } catch {
      this.showError('Unable to load news.');
    } finally {
      this.setLoading(false);
    }
  }

  displayNews() {
    const container = document.getElementById('news-grid') || document.getElementById('articles-container');
    if (!container) return;

    container.innerHTML = this.articles.map((a, i) => this.card(a, i)).join('');
  }

  card(a, i) {
    let timeAgo = '';
    if (a.publishedAt) {
      const hrs = Math.floor((Date.now() - new Date(a.publishedAt)) / 3600000);
      timeAgo = hrs < 1 ? 'Just now' : hrs < 24 ? `${hrs}h ago` : `${Math.floor(hrs / 24)}d ago`;
    }

    const img = a.urlToImage
      ? `<img src="${a.urlToImage}" alt="News image" onerror="this.parentElement.innerHTML='[Image unavailable]'">`
      : '[News Image]';

    return `
      <article class="news-card" onclick="window.open('${a.url}','_blank')" style="cursor:pointer;">
        <div class="news-image">${img}</div>
        <div class="news-content">
          <div class="news-meta">
            <span class="news-source">${this.escape(a.source?.name || 'News Source')}</span>
            ${timeAgo ? `<span class="news-time">${timeAgo}</span>` : ''}
          </div>
          <h2 class="news-title">${this.escape(a.title)}</h2>
          <p class="news-summary">${this.escape(a.description)}</p>
          <div class="impact-section">
            <div class="analysis-label">How Does This Affect Me?</div>
            <div class="impact-text" id="impact-${i}">${this.format(a.preGeneratedAnalysis || 'Analysis will appear shortly.')}</div>
          </div>
        </div>
      </article>
    `;
  }

  escape(t) {
    const d = document.createElement('div');
    d.textContent = t || '';
    return d.innerHTML;
  }

  format(t) {
    return (t || '')
      .split('\n\n')
      .map(p => `<p>${this.escape(p)}</p>`)
      .join('');
  }

  setLoading(loading) {
    this.loading = loading;
    const l = document.getElementById('loading');
    const container = document.getElementById('news-grid') || document.getElementById('articles-container');
    if (!l || !container) return;

    if (!this._origDisplay) {
      const computed = getComputedStyle(container).display;
      this._origDisplay = computed && computed !== 'none' ? computed : 'block';
    }

    l.style.display = loading ? 'block' : 'none';
    container.style.display = loading ? 'none' : this._origDisplay;
  }

  showError(msg) {
    const container = document.getElementById('news-grid') || document.getElementById('articles-container');
    if (!container) return;
    container.innerHTML = `
      <div class="error-state">
        <strong>Error:</strong> ${this.escape(msg)}
        <br><br>
        <button onclick="window.newsManager.fetchNews()" class="compare-btn">Try Again</button>
      </div>
    `;
  }

  refresh() {
    this.articles = [];
    this.fetchNews();
  }
}

if (typeof window !== 'undefined') {
  window.newsManager = new NewsManager();
}
