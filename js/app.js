// Main application initialization
class HDTAApp {
    constructor() {
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return;

        try {
            // Initialize all managers
            window.demographics = new Demographics();
            window.newsManager = new NewsManager();
            
            // Set up global functions
            this.setupGlobalFunctions();
            
            // Load initial news
            await window.newsManager.fetchNews();
            
            this.initialized = true;
            console.log('HDTA.me initialized successfully');
            
        } catch (error) {
            console.error('Failed to initialize HDTA.me:', error);
            this.showInitializationError();
        }
    }

    setupGlobalFunctions() {
        // Global function for compare mode (placeholder)
        window.toggleCompareMode = () => {
            alert('Compare mode coming soon! This will show side-by-side impacts for different demographics.');
        };

        // Global refresh function
        window.refreshNews = () => {
            if (window.newsManager) {
                window.newsManager.refresh();
            }
        };
    }

    showInitializationError() {
        const newsGrid = document.getElementById('news-grid');
        if (newsGrid) {
            newsGrid.innerHTML = `
                <div class="error-state">
                    <strong>Initialization Error</strong><br>
                    Failed to start HDTA.me. Please refresh the page.
                    <br><br>
                    <button onclick="location.reload()" class="compare-btn">Refresh Page</button>
                </div>
            `;
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    const app = new HDTAApp();
    await app.init();
});

// Handle page visibility changes to refresh stale news
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && window.newsManager) {
        // If page becomes visible and news is more than 30 minutes old, refresh
        const lastFetch = window.newsManager.lastFetchTime;
        const thirtyMinutes = 30 * 60 * 1000;
        
        if (lastFetch && Date.now() - lastFetch > thirtyMinutes) {
            window.newsManager.refresh();
        }
    }
});
