// admin-bulk.js - Bulk operations and manual article management (SIMPLIFIED - No personalize API)

// Manual Article Management
async function extractArticle() {
    const url = document.getElementById('article-url').value;
    if (!url) {
        adminPanel.addLog('error', 'Please enter a URL');
        return;
    }
    
    adminPanel.addLog('info', 'Extracting article content...');
    
    try {
        // This would call the content extraction API (if implemented)
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
    
    // Note: Analysis would need to be added manually via edit function
    // No automatic generation via personalize API
}

function clearManualForm() {
    document.getElementById('article-url').value = '';
    document.getElementById('manual-title').value = '';
    document.getElementById('manual-description').value = '';
    document.getElementById('manual-source').value = '';
    document.getElementById('manual-status').value = 'queue';
}

// REMOVED FUNCTIONS (No longer call /api/personalize):
// - bulkRegenerateAll()
// - bulkRegenerateDrafts() 
// - bulkAnalyzeQueue()

// Simplified bulk operations that don't require API calls
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

// Workflow helper functions
function showWorkflowNotice() {
    if (adminPanel && typeof adminPanel.addLog === 'function') {
        adminPanel.addLog('info', 'For fresh analysis, use "Force Refetch" to run the daily workflow');
    }
}

function bulkEditAnalysis() {
    const selected = adminPanel.articles.filter(a => a.status === 'published').slice(0, 5);
    if (selected.length === 0) {
        adminPanel.addLog('error', 'No published articles to edit');
        return;
    }
    
    adminPanel.addLog('info', `Opening first of ${selected.length} articles for editing`);
    const firstIndex = adminPanel.articles.findIndex(a => a.id === selected[0].id);
    if (firstIndex !== -1) {
        adminPanel.editAnalysis(firstIndex);
    }
}

// Bulk Progress UI Helpers (kept for potential future use)
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
