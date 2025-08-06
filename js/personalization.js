// js/personalization.js - Simplified without redundant caching
class Personalization {
    async generateImpactAnalysis(article, demographic) {
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
                return data.impact;
            } else {
                throw new Error('No impact analysis returned');
            }
        } catch (error) {
            console.error('Error generating personalized impact:', error);
            throw error;
        }
    }
}

// Initialize personalization when DOM is loaded
window.personalization = new Personalization();
