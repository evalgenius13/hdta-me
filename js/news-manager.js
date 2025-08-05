// News fetching and display management
class NewsManager {
    constructor() {
        this.articles = [];
        this.loading = false;
        this.lastFetchTime = null;
        this.displayedCount = 6; // NEW: Track displayed articles
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
                this.displayedCount = 6; // NEW: Reset count
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
        newsGrid.innerHTML = this.articles.slice(0, this.displayedCount).map(article => this.createArticleHTML(article)).join('');
        
        // NEW: Add load more button
        this.addLoadMoreButton();
        
        // Generate personalized impact for each article
        await this.updatePersonalization();
    }

    // NEW: Add load more button
    addLoadMoreButton() {
        const existingButton = document.getElementById('load-more-btn');
        if (existingButton) existingButton.remove();

        if (this.displayedCount < this.articles.length) {
            const remaining = this.articles.length - this.displayedCount;
            // Load 3 or 6 to keep grid balanced
            const loadCount = remaining >= 6 ? 6 : (remaining >= 3 ? 3 : remaining);
            
            const button = document.createElement('div');
            button.id = 'load-more-btn';
            button.innerHTML = `
                <div style="text-align: center; margin: 2rem 0;">
                    <button onclick="window.newsManager.loadMore()" class="compare-btn">
                        Load ${loadCount} More Articles
                    </button>
                </div>
            `;
            
            const newsGrid = document.getElementById('news-grid');
            newsGrid.parentNode.insertBefore(button, newsGrid.nextSibling);
        }
    }

    // NEW: Load more function
    async loadMore() {
        const oldCount = this.displayedCount;
        const remaining = this.articles.length - this.displayedCount;
        // Load 3 or 6 to keep grid balanced
        const loadCount = remaining >= 6 ? 6 : (remaining >= 3 ? 3 : remaining);
        this.displayedCount = Math.min(this.displayedCount + loadCount, this.articles.length);
        
        const newsGrid = document.getElementById('news-grid');
        const newArticles = this.articles.slice(oldCount, this.displayedCount);
        
        newArticles.forEach(article => {
            newsGrid.innerHTML += this.createArticleHTML(article);
        });

        this.addLoadMoreButton();
        
        // Update personalization for new articles only
        for (let i = oldCount; i < this.displayedCount; i++) {
            const article = this.articles[i];
            const impactElement = document.getElementById(`impact-${i}`);
            
            if (impactElement && window.personalization) {
                const demographic = window.demographics.getProfile();
                const detailedDemo = window.demographics.getDetailedProfile();
                
                try {
                    const impact = await window.personalization.generateImpactAnalysis(article, {
                        ...demographic,
                        detailed: detailedDemo
                    });
                    impactElement.innerHTML = impact;
                } catch (error) {
                    impactElement.innerHTML = 'Unable to generate personalized impact analysis.';
                }
            }
        }
    }

    async updatePersonalization() {
        if (!window.demographics || !window.personalization) return;

        const demographic = window.demographics.getProfile();
        const detailedDemo = window.demographics.getDetailedProfile();
        
        // Update each article's impact analysis
        for (let i = 0; i < Math.min(this.articles.length, this.displayedCount); i++) {
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
        this.displayedCount = 6; // NEW: Reset count
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
