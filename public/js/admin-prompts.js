// admin-prompts.js - Prompt management functionality (SIMPLIFIED - No personalize API calls)

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

// REMOVED: regenerateAnalysis() function - no longer calls /api/personalize
// Analysis is now only generated during daily workflow

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
        system: "You are a policy analyst who explains the real human impact of policy decisions with the depth and narrative style of a Time Magazine human rights story. Be approachable, engaging, and cut through political spin.",
        user: `Write 200-250 words like a compelling Time Magazine story. Structure as:

Human Impact - Real consequences people will face
Winners and Losers - Who benefits, who pays the price  
What's Not Being Said - What's happening beneath the surface
How Does This Affect Me - Personal relevance and broader implications

Be specific with numbers and timelines. Show human faces behind policy decisions. Reveal the interests and calculations not being discussed publicly.

Policy: "{title}"
Details: "{description}"
Source: "{source}"`
    },
    consumer: {
        system: "You are a policy analyst who explains the real human impact of policy decisions with the depth and narrative style of a Time Magazine human rights story. Be approachable, engaging, and cut through political spin.",
        user: `Write 200-250 words like a compelling Time Magazine story. Structure as:

Human Impact - Real consequences people will face
Winners and Losers - Who benefits, who pays the price  
What's Not Being Said - What's happening beneath the surface
How Does This Affect Me - Personal relevance and broader implications

Be specific with numbers and timelines. Show human faces behind policy decisions. Reveal the interests and calculations not being discussed publicly.

Policy: "{title}"
Details: "{description}"
Source: "{source}"`
    },
    technical: {
        system: "You are a policy analyst who explains the real human impact of policy decisions with the depth and narrative style of a Time Magazine human rights story. Be approachable, engaging, and cut through political spin.",
        user: `Write 200-250 words like a compelling Time Magazine story. Structure as:

**Human Impact** - Real consequences people will face
**Winners and Losers** - Who benefits, who pays the price  
**What's Not Being Said** - What's happening beneath the surface
**How Does This Affect Me** - Personal relevance and broader implications

Be specific with numbers and timelines. Show human faces behind policy decisions. Reveal the interests and calculations not being discussed publicly.

Policy: "{title}"
Details: "{description}"
Source: "{source}"`
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
    
    adminPanel.addLog('info', 'Prompt templates saved for daily workflow usage');
    adminPanel.addLog('warning', 'Note: Prompts are used during daily workflow, not for individual regeneration');
    
    // Show test result area with workflow notice
    const resultDiv = document.getElementById('prompt-test-result');
    if (resultDiv) {
        resultDiv.style.display = 'block';
        resultDiv.querySelector('div').innerHTML = `
            <strong>Test Article:</strong> ${adminPanel.escapeHtml(testArticle.title)}<br>
            <strong>System Prompt:</strong> ${systemPrompt.substring(0, 100)}...<br>
            <strong>User Prompt:</strong> ${userPrompt.substring(0, 100)}...<br>
            <div style="background: #eff6ff; padding: 12px; border-radius: 6px; margin-top: 12px; border: 1px solid #dbeafe;">
                <strong>💡 Note:</strong> Prompts will be used during the next daily workflow run. 
                Use "Force Refetch" to test with fresh articles and your saved prompts.
            </div>
        `;
    }
}

function savePrompts() {
    savePromptTemplate();
}

function resetPrompts() {
    document.getElementById('prompt-editor').value = "You are a policy explainer who breaks down complex government decisions into plain English. Be straightforward, factual, and tell it like it is without political spin or jargon.";
    document.getElementById('user-prompt-editor').value = "Write 200-250 words explaining this policy in plain English without any formatting or markdown. Structure as:\n\nHuman Impact - Real consequences people will face\nWinners and Losers - Who benefits, who pays the price\nWhat's Not Being Said - What's happening beneath the surface\nHow Does This Affect Me - Personal relevance and broader implications\n\nWrite in flowing paragraphs without bold text or special formatting. Be specific with numbers and timelines. Show human faces behind policy decisions. Reveal the interests and calculations not being discussed publicly.\n\nPolicy: \"{title}\"\nDetails: \"{description}\"\nSource: \"{source}\"\nDate: \"{date}\"";
    adminPanel.addLog('info', 'Prompts reset to default');
}

// Workflow-focused prompt management
function showPromptWorkflowNotice() {
    if (adminPanel && typeof adminPanel.addLog === 'function') {
        adminPanel.addLog('info', 'Prompts are applied during daily workflow - use Force Refetch to test changes');
    }
}
