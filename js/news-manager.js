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

        // Display articles with loading placeholders for personalization
        newsGrid.innerHTML = this.articles.slice(0, 6).map(article => this.createArticleHTML(article)).join('');
        
        // Generate personalized impact for each article
        await this.updatePersonalization();
    }

    async updatePersonalization() {
        if (!window.demographics || !window.personalization) return;

        const demographic = window.demographics.getProfile();
        const detailedDemo = window.demographics.getDetailedProfile();
        
        // Update each article's impact analysis
        for (let i = 0; i < Math.min(this.articles.length, 6); i++) {
            const article = this.articles[i];
            const impactElement = document.getElementById(`impact-${i}`);
            
            if (impactElement) {
                impactElement.innerHTML = '<div class="impact-loading">Analyzing how this affects you...</div>';
                
                try {
                    const impact = await window.personalization.generateImpactAnalysis(article, {
                        ...demographic,
                        detailed: detailedDemo
                    });
                    
                    impactElement.innerHTML = impact;
                } catch (error) {
                    console.error('Error generating impact for article:', error);
                    impactElement.innerHTML = 'Unable to generate personalized impact analysis.';
                }
            }
        }
    }

    createArticleHTML(article) {
        const articleIndex = this.articles.indexOf(article);
        
        return `
            <article class="news-card">
                <div class="news-image">
                    ${article.image || article.urlToImage ? 
                        `<img src="${article.image || article.urlToImage}" alt="News image" onerror="this.parentElement.innerHTML='[Image unavailable]'">` : 
                        '[News Image]'
                    }
                </div>
                <div class="news-content">
                    <h2 class="news-title">${this.escapeHtml(article.title)}</h2>
                    <p class="news-summary">${this.escapeHtml(article.description)}</p>
                    
                    <div class="impact-section">
                        <div class="impact-title">How this affects you:</div>
                        <div class="impact-text" id="impact-${articleIndex}">
                            <div class="impact-loading">Loading personalized analysis...</div>
                        </div>
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
