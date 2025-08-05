// News fetching and display management
class NewsManager {
    constructor() {
        this.articles = [];
        this.loading = false;
        this.lastFetchTime = null;
        this.displayedCount = 6; // Track how many articles are currently displayed
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
                this.displayedCount = 6; // Reset to initial display count
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

        // Display articles up to the current displayedCount
        const articlesToShow = this.articles.slice(0, this.displayedCount);
        newsGrid.innerHTML = articlesToShow.map(article => this.createArticleHTML(article)).join('');
        
        // Add load more button if there are more articles
        this.addLoadMoreButton();
        
        // Generate personalized impact for displayed articles
        await this.updatePersonalization();
    }

    addLoadMoreButton() {
        const newsGrid = document.getElementById('news-grid');
        const existingButton = document.getElementById('load-more-btn');
        
        // Remove existing button if it exists
        if (existingButton) {
            existingButton.remove();
        }

        // Only show button if there are more articles to load
        if (this.displayedCount < this.articles.length) {
            const remainingCount = this.articles.length - this.displayedCount;
            const loadMoreCount = Math.min(6, remainingCount);
            
            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'load-more-container';
            buttonContainer.id = 'load-more-btn';
            buttonContainer.innerHTML = `
                <button class="load-more-button" onclick="window.newsManager.loadMoreArticles()">
                    Load ${loadMoreCount} More Articles
                </button>
                <div class="articles-count">
                    Showing ${this.displayedCount} of ${this.articles.length} stories
                </div>
            `;
            
            newsGrid.parentNode.insertBefore(buttonContainer, newsGrid.nextSibling);
        }
    }

    async loadMoreArticles() {
        const previousCount = this.displayedCount;
        this.displayedCount = Math.min(this.displayedCount + 6, this.articles.length);
        
        // Add the new articles to the grid
        const newsGrid = document.getElementById('news-grid');
        const newArticles = this.articles.slice(previousCount, this.displayedCount);
        
        newArticles.forEach(article => {
            newsGrid.innerHTML += this.createArticleHTML(article);
        });

        // Update the load more button
        this.addLoadMoreButton();
        
        // Generate personalized impact for the new articles
        await this.updatePersonalizationForRange(previousCount, this.displayedCount);
    }

    async updatePersonalization() {
        await this.updatePersonalizationForRange(0, this.displayedCount);
    }

    async updatePersonalizationForRange(startIndex, endIndex) {
        if (!window.demographics || !window.personalization) return;

        const demographic = window.demographics.getProfile();
        const detailedDemo = window.demographics.getDetailedProfile();
        
        // Update each article's impact analysis in the specified range
        for (let i = startIndex; i < Math.min(endIndex, this.articles.length); i++) {
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
                    ${article.image ? 
                        `<img src="${article.image}" alt="News image" onerror="this.parentElement.innerHTML='[Image unavailable]'">` : 
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
        this.displayedCount = 6;
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
