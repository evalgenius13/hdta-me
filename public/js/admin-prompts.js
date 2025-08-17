// admin-prompts.js - Analysis editing only (prompts managed via environment variables)

// Analysis editing methods only
AdminPanel.prototype.saveAnalysis = async function() {
    const editor = document.getElementById('analysis-editor');
    const index = parseInt(editor.dataset.articleIndex);
    const newAnalysis = editor.value.trim();
    
    if (newAnalysis && this.articles[index]?.id) {
        try {
            const response = await fetch(`${this.API_BASE}/api/admin?action=update-analysis`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.adminKey}`
                },
                body: JSON.stringify({
                    articleId: this.articles[index].id,
                    newAnalysis: newAnalysis
                })
            });
            
            if (response.ok) {
                this.articles[index].preGeneratedAnalysis = newAnalysis;
                this.renderArticles(this.currentFilter);
                this.addLog('success', `Updated analysis for article ${index + 1}`);
            } else {
                throw new Error('Failed to save analysis');
            }
        } catch (error) {
            this.addLog('error', 'Failed to save analysis: ' + error.message);
        }
    } else {
        // Local update only if no article ID
        this.articles[index].preGeneratedAnalysis = newAnalysis;
        this.renderArticles(this.currentFilter);
        this.addLog('warning', 'Updated locally only (no database save)');
    }
    
    this.closeModal();
};

AdminPanel.prototype.saveAnalysisToDatabase = async function(articleId, analysis) {
    try {
        await fetch(`${this.API_BASE}/api/admin?action=update-analysis`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.adminKey}`
            },
            body: JSON.stringify({ articleId, newAnalysis: analysis })
        });
    } catch (error) {
        this.addLog('warning', 'Failed to save to database: ' + error.message);
    }
};
