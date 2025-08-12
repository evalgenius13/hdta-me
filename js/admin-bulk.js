// admin-bulk.js - Bulk operations and manual article management

// Manual Article Management
async function extractArticle() {
    const url = document.getElementById('article-url').value;
    if (!url) {
        adminPanel.addLog('error', 'Please enter a URL');
        return;
    }
    
    adminPanel.addLog('info', 'Extracting article content...');
    
    try {
        // This would call the content extraction API
        const response = await fetch(`${adminPanel.API_BASE}/api/extract-content`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        
        const data = await response.json();
        if (data.success) {
            document.getElementById('manual-title').value = data.content.title || '';
            document.getElementById('manual-description').value = data.content.content || '';
            document.getElementById('manual-source').value = url.split('/')[2] || '';
            adminPanel.addLog('success', 'Article extracted successfully');
        } else {
            adminPanel.addLog('error', 'Failed to extract article: ' + data.error);
        }
    } catch (error) {
        adminPanel.addLog('error', 'Extraction failed: ' + error.message);
    }
}

function addManualArticle() {
    const title = document.getElementById('manual-title').value;
    const description = document.getElementById('manual-description').value;
    const source = document.getElementById('manual-source').value;
    const url = document.getElementById('article-url').value;
    const status = document.getElementById('manual-status').value;
    
    if (!title || !description) {
        adminPanel.addLog('error', 'Title and description are required');
        return;
    }
    
    const newArticle = {
        id: 'manual-' + Date.now(),
        title: title,
        description: description,
        url: url,
        source: { name: source },
        publishedAt: new Date().toISOString(),
        status: status,
        preGeneratedAnalysis: null
    };
    
    adminPanel.articles.unshift(newArticle);
    adminPanel.renderArticles(adminPanel.currentFilter || 'all');
    adminPanel.updateStats();
    adminPanel.addLog('success', 'Manual article added');
    
    // Auto-analyze if status is draft or published
    if (status === 'draft' || status === 'published') {
        setTimeout(() => {
            adminPanel.regenerateAnalysis(0);
        }, 500);
    }
}

function clearManualForm() {
    document.getElementById('article-url').value = '';
    document.getElementById('manual-title').value = '';
    document.getElementById('manual-description').value = '';
    document.getElementById('manual-source').value = '';
    document.getElementById('manual-status').value = 'queue';
}

// Bulk Operations
async function bulkRegenerateAll() {
    const published = adminPanel.articles.filter(a => a.status === 'published' || a.order <= 6);
    if (published.length === 0) {
        adminPanel.addLog('error', 'No published articles to regenerate');
        return;
    }
    
    if (!confirm(`Regenerate analysis for ${published.length} published articles?`)) return;
    
    showBulkProgress();
    adminPanel.addLog('info', `Starting bulk regeneration of ${published.length} articles`);
    
    for (let i = 0; i < published.length; i++) {
        const article = published[i];
        const progress = ((i + 1) / published.length) * 100;
        updateBulkProgress(progress, `Regenerating ${i + 1}/${published.length}: ${article.title.substring(0, 40)}...`);
        
        try {
            const response = await fetch(`${adminPanel.API_BASE}/api/personalize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ article })
            });
            
            const data = await response.json();
            if (data.impact) {
                const index = adminPanel.articles.findIndex(a => a.id === article.id || a.title === article.title);
                if (index !== -1) {
                    adminPanel.articles[index].preGeneratedAnalysis = data.impact;
                }
            }
            
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            adminPanel.addLog('error', `Failed to regenerate: ${article.title.substring(0, 30)}`);
        }
    }
    
    hideBulkProgress();
    adminPanel.renderArticles(adminPanel.currentFilter);
    adminPanel.updateStats();
    adminPanel.addLog('success', 'Bulk regeneration completed');
}

async function bulkRegenerateDrafts() {
    const drafts = adminPanel.articles.filter(a => a.status === 'draft');
    if (drafts.length === 0) {
        adminPanel.addLog('error', 'No draft articles to regenerate');
        return;
    }
    
    if (!confirm(`Regenerate analysis for ${drafts.length} draft articles?`)) return;
    
    showBulkProgress();
    adminPanel.addLog('info', `Starting bulk regeneration of ${drafts.length} draft articles`);
    
    for (let i = 0; i < drafts.length; i++) {
        const article = drafts[i];
        const progress = ((i + 1) / drafts.length) * 100;
        updateBulkProgress(progress, `Regenerating draft ${i + 1}/${drafts.length}: ${article.title.substring(0, 40)}...`);
        
        try {
            const response = await fetch(`${adminPanel.API_BASE}/api/personalize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ article })
            });
            
            const data = await response.json();
            if (data.impact) {
                const index = adminPanel.articles.findIndex(a => a.id === article.id || a.title === article.title);
                if (index !== -1) {
                    adminPanel.articles[index].preGeneratedAnalysis = data.impact;
                }
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            adminPanel.addLog('error', `Failed to regenerate draft: ${article.title.substring(0, 30)}`);
        }
    }
    
    hideBulkProgress();
    adminPanel.renderArticles(adminPanel.currentFilter);
    adminPanel.updateStats();
    adminPanel.addLog('success', 'Draft regeneration completed');
}

async function bulkAnalyzeQueue() {
    const queue = adminPanel.articles.filter(a => a.status === 'queue' || (!a.preGeneratedAnalysis && !a.order));
    if (queue.length === 0) {
        adminPanel.addLog('error', 'No queued articles to analyze');
        return;
    }
    
    if (!confirm(`Analyze ${queue.length} queued articles?`)) return;
    
    showBulkProgress();
    adminPanel.addLog('info', `Analyzing ${queue.length} queued articles`);
    
    for (let i = 0; i < queue.length; i++) {
        const article = queue[i];
        const progress = ((i + 1) / queue.length) * 100;
        updateBulkProgress(progress, `Analyzing ${i + 1}/${queue.length}: ${article.title.substring(0, 40)}...`);
        
        try {
            const response = await fetch(`${adminPanel.API_BASE}/api/personalize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ article })
            });
            
            const data = await response.json();
            if (data.impact) {
                const index = adminPanel.articles.findIndex(a => a.id === article.id || a.title === article.title);
                if (index !== -1) {
                    adminPanel.articles[index].preGeneratedAnalysis = data.impact;
                    adminPanel.articles[index].status = 'draft'; // Move to draft after analysis
                }
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            adminPanel.addLog('error', `Failed to analyze: ${article.title.substring(0, 30)}`);
        }
    }
    
    hideBulkProgress();
    adminPanel.renderArticles(adminPanel.currentFilter);
    adminPanel.updateStats();
    adminPanel.addLog('success', 'Queue analysis completed');
}

function bulkFindReplace() {
    const findText = document.getElementById('find-text').value;
    const replaceText = document.getElementById('replace-text').value;
    
    if (!findText) {
        adminPanel.addLog('error', 'Enter text to find');
        return;
    }
    
    let replacements = 0;
    adminPanel.articles.forEach(article => {
        if (article.preGeneratedAnalysis && article.preGeneratedAnalysis.includes(findText)) {
            article.preGeneratedAnalysis = article.preGeneratedAnalysis.replace(new RegExp(findText, 'g'), replaceText);
            replacements++;
        }
    });
    
    adminPanel.renderArticles(adminPanel.currentFilter);
    adminPanel.addLog('success', `Made ${replacements} replacements`);
    
    // Clear the find/replace inputs
    document.getElementById('find-text').value = '';
    document.getElementById('replace-text').value = '';
}

function bulkPromoteQueue() {
    const queue = adminPanel.articles.filter(a => a.status === 'queue').slice(0, 3);
    if (queue.length === 0) {
        adminPanel.addLog('error', 'No queued articles to promote');
        return;
    }
    
    queue.forEach(article => {
        article.status = 'published';
        article.order = adminPanel.articles.filter(a => a.status === 'published').length + 1;
    });
    
    adminPanel.renderArticles(adminPanel.currentFilter);
    adminPanel.updateStats();
    adminPanel.addLog('success', `Promoted ${queue.length} articles from queue to published`);
}

function bulkDemoteWorst() {
    const published = adminPanel.articles.filter(a => a.status === 'published').slice(-2);
    if (published.length === 0) {
        adminPanel.addLog('error', 'No published articles to demote');
        return;
    }
    
    published.forEach(article => {
        article.status = 'draft';
        delete article.order;
    });
    
    adminPanel.renderArticles(adminPanel.currentFilter);
    adminPanel.updateStats();
    adminPanel.addLog('warning', `Demoted ${published.length} articles to drafts`);
}

function bulkDeleteRejected() {
    if (!confirm('Delete all rejected articles? This cannot be undone.')) return;
    
    const beforeCount = adminPanel.articles.length;
    adminPanel.articles = adminPanel.articles.filter(a => a.status !== 'rejected');
    const deleted = beforeCount - adminPanel.articles.length;
    
    adminPanel.renderArticles(adminPanel.currentFilter);
    adminPanel.updateStats();
    adminPanel.addLog('warning', `Deleted ${deleted} rejected articles`);
}

function bulkDeleteOld() {
    if (!confirm('Delete articles older than 7 days? This cannot be undone.')) return;
    
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    const beforeCount = adminPanel.articles.length;
    adminPanel.articles = adminPanel.articles.filter(a => new Date(a.publishedAt) > weekAgo);
    const deleted = beforeCount - adminPanel.articles.length;
    
    adminPanel.renderArticles(adminPanel.currentFilter);
    adminPanel.updateStats();
    adminPanel.addLog('warning', `Deleted ${deleted} old articles`);
}

function resetToday() {
    if (!confirm('Reset today\'s entire edition? This will delete everything and start fresh.')) return;
    
    adminPanel.articles = [];
    adminPanel.renderArticles(adminPanel.currentFilter);
    adminPanel.updateStats();
    adminPanel.addLog('warning', 'Today\'s edition reset - all articles cleared');
}

// Bulk Progress UI Helpers
function showBulkProgress() {
    const progressDiv = document.getElementById('bulk-progress');
    if (progressDiv) {
        progressDiv.style.display = 'block';
    }
}

function updateBulkProgress(percent, status) {
    const progressBar = document.getElementById('bulk-progress-bar');
    const statusText = document.getElementById('bulk-status');
    
    if (progressBar) {
        progressBar.style.width = Math.round(percent) + '%';
    }
    if (statusText) {
        statusText.textContent = status;
    }
}

function hideBulkProgress() {
    const progressDiv = document.getElementById('bulk-progress');
    if (progressDiv) {
        progressDiv.style.display = 'none';
    }
}
