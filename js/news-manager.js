// News fetching and display management
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
                this.articles = data.articles.filter(article => 
                    article.title && 
                    article.description && 
                    !article.title.includes('[Removed]')
                );
                await this.displayNews();
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

        // Display all articles - no limit
        newsGrid.innerHTML = this.articles.map(article => this.createArticleHTML(article)).join('');
    }

    async getAnalysis(articleIndex) {
        const article = this.articles[articleIndex];
        const impactElement = document.getElementById(`impact-${articleIndex}`);
        
        if (!article) {
            console.error('Article not found for index:', articleIndex);
            return;
        }
        
        if (!impactElement) {
            console.error('Impact element not found for index:', articleIndex);
            return;
        }

        if (!window.personalization || !window.demographics) {
            console.error('Personalization or demographics not loaded');
            impactElement.innerHTML = 'System not ready. Please refresh the page.';
            return;
        }
        
        impactElement.innerHTML = '<div class="impact-loading">Analyzing how this affects you...</div>';
        
        try {
            const demographic = window.demographics.getProfile();
            const detailedDemo = window.demographics.getDetailedProfile();
            
            const impact = await window.personalization.generateImpactAnalysis(article, {
                ...demographic,
                detailed: detailedDemo
            });
            
            impactElement.innerHTML = impact;
        } catch (error) {
            console.error('Error generating impact for article:', error);
            impactElement.innerHTML = 'Unable to generate analysis. Please try again.';
        }
    }

    createArticleHTML(article) {
        const articleIndex = this.articles.indexOf(article);
        
        // Format publish time
        let timeAgo = '';
        if (article.publishedAt) {
            const publishTime = new Date(article.publishedAt);
            const now = new Date();
            const diffHours = Math.floor((now - publishTime) / (1000 * 60 * 60));
            
            if (diffHours < 1) {
                timeAgo = 'Just now';
            } else if (diffHours < 24) {
                timeAgo = `${diffHours}h ago`;
            } else {
                const diffDays = Math.floor(diffHours / 24);
                timeAgo = `${diffDays}d ago`;
            }
        }
        
        return `
            <article class="news-card">
                <div class="news-image">
                    ${article.image || article.urlToImage ? 
                        `<img src="${article.image || article.urlToImage}" alt="News image" onerror="this.parentElement.innerHTML='[Image unavailable]'">` : 
                        '[News Image]'
                    }
                </div>
                <div class="news-content">
                    <div class="news-meta">
                        <span class="news-source">${article.source?.name || 'Unknown Source'}</span>
                        ${timeAgo ? `<span class="news-time">${timeAgo}</span>` : ''}
                    </div>
                    <h2 class="news-title">${this.escapeHtml(article.title)}</h2>
                    <p class="news-summary">${this.escapeHtml(article.description)}</p>
                    
                    <div class="impact-section">
                        <button onclick="window.newsManager.getAnalysis(${articleIndex})" class="compare-btn" style="margin-bottom: 0.5rem;">
                            How Does This Affect Me?
                        </button>
                        <div class="impact-text" id="impact-${articleIndex}"></div>
                    </div>
                </div>
            </article>
        `;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    setLoading(loading) {
        this.loading = loading;
        const loadingElement = document.getElementById('loading');
        const newsGrid = document.getElementById('news-grid');
        
        if (loadingElement && newsGrid) {
            loadingElement.innerHTML = loading ? 
                '<div>Loading latest news...</div>' : 
                '<div>Loading latest news...</div>';
            loadingElement.style.display = loading ? 'block' : 'none';
            newsGrid.style.display = loading ? 'none' : 'grid';
        }
    }

    showError(message) {
        const newsGrid = document.getElementById('news-grid');
        if (newsGrid) {
            newsGrid.innerHTML = `
                <div class="error-state">
                    <strong>Error:</strong> ${message}
                    <br><br>
                    <button onclick="window.newsManager.fetchNews()" class="compare-btn">Try Again</button>
                </div>
            `;
        }
    }

    refresh() {
        this.articles = [];
        if (window.personalization) {
            window.personalization.clearCache();
        }
        this.fetchNews();
    }
}

// Initialize news manager when DOM is loaded
if (typeof window !== 'undefined') {
    window.newsManager = null;
}
