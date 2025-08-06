// OpenAI-powered personalization
class Personalization {
    constructor() {
        this.cache = new Map(); // Cache personalized responses
    }

    async generateImpactAnalysis(article, demographic) {
        const cacheKey = `${article.title}-${JSON.stringify(demographic)}`;
        
        // Check cache first
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        try {
            const response = await fetch('/api/personalize', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    article: {
                        title: article.title,
                        description: article.description
                    },
                    demographic: demographic
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            if (data.impact) {
                // Cache the result
                this.cache.set(cacheKey, data.impact);
                return data.impact;
            } else {
                throw new Error('No impact analysis returned');
            }

        } catch (error) {
            console.error('Error generating personalized impact:', error);
            throw error; // Let the error bubble up so you can see failures
        }
    }

    clearCache() {
        this.cache.clear();
    }

    getCacheSize() {
        return this.cache.size;
    }
}

// Initialize personalization when DOM is loaded
window.personalization = new Personalization();
