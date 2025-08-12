// admin-prompts.js - Prompt management functionality

// Analysis methods
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

AdminPanel.prototype.regenerateAnalysis = async function(index) {
    const article = this.articles[index];
    this.addLog('info', `Regenerating analysis for: ${article.title.substring(0, 50)}...`);
    
    try {
        const response = await fetch(`${this.API_BASE}/api/personalize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ article })
        });
        
        const data = await response.json();
        if (data.impact) {
            this.articles[index].preGeneratedAnalysis = data.impact;
            this.addLog('success', 'Analysis regenerated successfully');
            
            // Force full re-render instead of just updating one element
            this.renderArticles(this.currentFilter);
            this.updateStats();
            
            // Try to save to database if we have an article ID
            if (article.id) {
                this.saveAnalysisToDatabase(article.id, data.impact);
            }
        } else {
            this.addLog('error', 'No analysis returned from API');
        }
    } catch (error) {
        this.addLog('error', 'Failed to regenerate analysis: ' + error.message);
    }
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

// Prompt template management
const PromptTemplates = {
    insider: {
        system: "You are a seasoned policy insider who explains complex regulations in terms of real human impact. Be specific, credible, and revealing about how policy actually works in practice.",
        user: `Write exactly 140-170 words as a compelling insider analysis. Use plain English but show deep policy knowledge.

1) IMMEDIATE IMPACT: Lead with concrete consequences people will feel. Be specific about dollar amounts and timelines.
2) THE MECHANICS: How does this actually work? Include specific deadlines, eligibility, implementation details.
3) WINNERS & LOSERS: Who actually benefits and who gets hurt? Be direct about specific industries, regions, demographics.
4) INSIDER PERSPECTIVE: What's not being said publicly? Historical precedent? Hidden motivations?

Policy: "{title}"
Details: "{description}"
Source: "{source}"`
    },
    consumer: {
        system: "You are a consumer advocate who translates policy into practical impact for everyday people. Focus on costs, benefits, and actionable steps.",
        user: `Write 140-170 words explaining how this affects regular people's wallets and daily lives.

1) MONEY IMPACT: Exact costs or savings for typical household
2) TIMELINE: When changes take effect, deadlines to know
3) ACTION NEEDED: What people should do to prepare or benefit
4) WATCH OUT FOR: Hidden costs, eligibility requirements, catches

Policy: "{title}"  
Details: "{description}"`
    },
    technical: {
        system: "You are a policy analyst who provides detailed technical analysis with specific data, citations, and implementation mechanics.",
        user: `Write a detailed 150-200 word technical analysis covering:

1) REGULATORY FRAMEWORK: Specific sections, implementation timeline
2) AFFECTED PARTIES: Industries, demographics, geographic regions with data
3) COMPLIANCE REQUIREMENTS: Specific obligations, reporting, penalties
4) PRECEDENT & CONTEXT: Historical comparison, legal basis

Policy: "{title}"
Details: "{description}"
Source: "{source}"
Date: "{date}"`
    }
};

// Global prompt functions
function loadPromptTemplate() {
    const selected = document.getElementById('prompt-select').value;
    const systemPrompt = document.getElementById('prompt-editor');
    const userPrompt = document.getElementById('user-prompt-editor');
    
    if (PromptTemplates[selected]) {
        systemPrompt.value = PromptTemplates[selected].system;
        userPrompt.value = PromptTemplates[selected].user;
        adminPanel.addLog('info', `Loaded ${selected} template`);
    }
}

function savePromptTemplate() {
    const systemPrompt = document.getElementById('prompt-editor').value;
    const userPrompt = document.getElementById('user-prompt-editor').value;
    
    // Save to localStorage
    localStorage.setItem('hdta-custom-system-prompt', systemPrompt);
    localStorage.setItem('hdta-custom-user-prompt', userPrompt);
    adminPanel.addLog('success', 'Prompts saved successfully');
}

function testPrompt() {
    if (adminPanel.articles.length === 0) {
        adminPanel.addLog('error', 'No articles available for testing');
        return;
    }
    
    const testArticle = adminPanel.articles[0];
    const systemPrompt = document.getElementById('prompt-editor').value;
    const userPrompt = document.getElementById('user-prompt-editor').value;
    
    adminPanel.addLog('info', 'Testing prompt with first article...');
    adminPanel.addLog('warning', 'Prompt testing requires backend implementation');
    
    // Show test result area
    const resultDiv = document.getElementById('prompt-test-result');
    if (resultDiv) {
        resultDiv.style.display = 'block';
        resultDiv.querySelector('div').innerHTML = `
            <strong>Test Article:</strong> ${adminPanel.escapeHtml(testArticle.title)}<br>
            <strong>System Prompt:</strong> ${systemPrompt.substring(0, 100)}...<br>
            <strong>User Prompt:</strong> ${userPrompt.substring(0, 100)}...<br>
            <em>Backend implementation needed to generate actual test result.</em>
        `;
    }
}

function savePrompts() {
    savePromptTemplate();
}

function resetPrompts() {
    document.getElementById('prompt-editor').value = "You are a seasoned policy insider who explains complex regulations in terms of real human impact. Be specific, credible, and revealing about how policy actually works in practice. Avoid euphemisms and jargon while maintaining credibility.";
    document.getElementById('user-prompt-editor').value = `Write 130 to 170 words as a compelling insider analysis that reveals what's really happening. Plain English but deep policy knowledge.

1) IMMEDIATE IMPACT: Lead with the concrete consequence people will feel. Be specific - "Your student loan payment drops $150/month" not "payments may change." Think like someone who's seen this before.

2) THE REAL MECHANICS: How does this actually work? Include specific timelines, dollar amounts, eligibility details. What's the implementation reality vs. the press release spin?

3) WINNERS & LOSERS: Who actually benefits and who gets hurt? Be direct about specific industries, regions, or groups when the evidence supports it.

4) INSIDER PERSPECTIVE: What's not being emphasized publicly? Historical context? Hidden timelines? Watch for details that signal the true long-term impact.

Policy: "{title}"
Details: "{description}"
Source: "{source}"
Date: "{date}"`;
    adminPanel.addLog('info', 'Prompts reset to default');
}
