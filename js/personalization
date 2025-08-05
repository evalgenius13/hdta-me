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
            return this.getFallbackImpact(article, demographic);
        }
    }

    getFallbackImpact(article, demographic) {
        // Fallback to basic rule-based analysis if OpenAI fails
        const title = article.title.toLowerCase();
        const description = article.description.toLowerCase();
        const profile = demographic.display;
        
        if (title.includes('interest rate') || title.includes('fed') || description.includes('interest')) {
            if (demographic.housing === 'renter') {
                return `As a ${profile}, rising interest rates could cool the housing market over 6-12 months, potentially giving you more rental options. However, your credit card rates will likely increase within 1-2 billing cycles.`;
            } else if (demographic.housing === 'owner') {
                return `As a ${profile}, if you have a variable-rate mortgage or HELOC, your payments will increase. Fixed-rate mortgage holders won't see immediate impact, but home values may moderate.`;
            }
        }
        
        if (title.includes('job') || title.includes('employment') || title.includes('unemployment')) {
            if (demographic.income === 'under30k') {
                return `As a ${profile}, job market changes significantly impact your opportunities. This news suggests ${title.includes('gain') ? 'more entry-level positions may open up' : 'competition for positions in your income range may increase'}.`;
            } else if (demographic.income === '100k+') {
                return `As a ${profile}, broader employment trends may affect your company's hiring and growth plans, potentially impacting bonuses, promotions, or job security in your sector.`;
            }
        }
        
        if (title.includes('tax') || description.includes('tax')) {
            if (demographic.age === 'genz' || demographic.age === 'millennial') {
                return `As a ${profile}, tax changes often disproportionately affect younger earners. This could impact your take-home pay starting next tax year, affecting your ability to save for major purchases.`;
            } else if (demographic.age === 'boomer') {
                return `As a ${profile}, this tax news may affect your retirement planning or current retirement income. Consider consulting a financial advisor about adjusting your strategy.`;
            }
        }
        
        if (title.includes('housing') || title.includes('rent') || title.includes('real estate')) {
            if (demographic.housing === 'renter' && demographic.location === 'virginia') {
                return `As a ${profile}, housing market changes in Virginia directly affect your rent prices and availability. This could impact your monthly budget within 6-12 months.`;
            } else if (demographic.housing === 'owner') {
                return `As a ${profile}, this housing news affects your property value and equity. Changes may impact refinancing opportunities or future selling decisions.`;
            }
        }
        
        // Default fallback
        return `Based on your profile as a ${profile}, this news may have varying impacts on your financial situation. Consider how broader economic trends in this story might affect your local job market, living costs, and the services available in your area.`;
    }

    clearCache() {
        this.cache.clear();
    }

    getCacheSize() {
        return this.cache.size;
    }
}

// Initialize personalization when DOM is loaded
if (typeof window !== 'undefined') {
    window.personalization = new Personalization();
}
