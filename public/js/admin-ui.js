// admin-ui.js - UI rendering and article management with images
AdminPanel.prototype.renderArticles = function(filter = 'all') {
    const grid = document.getElementById('articles-grid');
    if (!grid) return;
    
    let articlesToShow = this.articles;
    
    // Apply filter
    if (filter === 'published') {
        articlesToShow = this.articles.filter(a => a.status === 'published' || a.order <= 6);
    } else if (filter === 'drafts') {
        articlesToShow = this.articles.filter(a => a.status === 'draft');
    } else if (filter === 'queue') {
        articlesToShow = this.articles.filter(a => a.status === 'queue' || (!a.preGeneratedAnalysis && !a.order));
    } else if (filter === 'rejected') {
        articlesToShow = this.articles.filter(a => a.status === 'rejected');
    }
    
    // Update filter button counts
    this.updateFilterCounts();
    
    grid.innerHTML = articlesToShow.map((article, index) => {
        const realIndex = this.articles.indexOf(article); // Get real index in full array
        const safeIndex = String(realIndex);
        const safeTitle = this.escapeHtml(article.title || '');
        const safeDescription = this.escapeHtml(article.description || '');
        const safeMeta = this.escapeHtml(article.source?.name || 'Unknown Source');
        const safeUrl = this.escapeHtml(article.url || '');
        const imageUrl = article.urlToImage || article.image_url;
        const timeAgo = this.getTimeAgo(article.publishedAt);
        const hasAnalysis = article.preGeneratedAnalysis;
        const statusClass = hasAnalysis ? 'status-success' : 'status-warning';
        const statusText = hasAnalysis ? 'Analysis Generated' : 'Using Fallback';
        const analysisContent = this.formatAnalysis(article.preGeneratedAnalysis || 'No analysis available');
        
        // Determine article status and actions
        const isPublished = article.status === 'published' || article.order <= 6;
        const isDraft = article.status === 'draft';
        const isQueue = article.status === 'queue' || (!hasAnalysis && !article.order);
        const isRejected = article.status === 'rejected';
        
        let statusBadge = '';
        if (isPublished) statusBadge = '<span style="background: #dcfce7; color: #166534; padding: 2px 6px; border-radius: 12px; font-size: 11px;">PUBLISHED</span>';
        else if (isDraft) statusBadge = '<span style="background: #fef3c7; color: #92400e; padding: 2px 6px; border-radius: 12px; font-size: 11px;">DRAFT</span>';
        else if (isQueue) statusBadge = '<span style="background: #e0e7ff; color: #3730a3; padding: 2px 6px; border-radius: 12px; font-size: 11px;">QUEUE</span>';
        else if (isRejected) statusBadge = '<span style="background: #fee2e2; color: #991b1b; padding: 2px 6px; border-radius: 12px; font-size: 11px;">REJECTED</span>';
        
        let statusActions = '';
        if (isPublished) {
            statusActions = `<button class="btn btn-small btn-secondary" onclick="adminPanel.demoteArticle(${safeIndex})">⬇️ Demote</button>`;
        } else if (isDraft || isQueue) {
            statusActions = `<button class="btn btn-small" onclick="adminPanel.promoteArticle(${safeIndex})">⬆️ Promote</button>`;
        }
        
        return `
            <div class="article-card">
                <div class="article-image">
                    ${imageUrl ? 
                        `<img src="${this.escapeHtml(imageUrl)}" alt="Article image" onerror="this.style.display='none'; this.parentElement.innerHTML='📰';">` : 
                        '📰'
                    }
                </div>
                
                <div class="article-body">
                    <div class="article-header">
                        <div style="flex: 1;">
                            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                                <div class="article-title" style="flex: 1;">${safeTitle}</div>
                                ${statusBadge}
                            </div>
                            <div class="article-meta">
                                ${safeMeta} • ${timeAgo}
                            </div>
                        </div>
                        <div class="article-score">Score: ${article.score || '--'}</div>
                    </div>
                    
                    <div class="article-content">
                        <div class="article-description">
                            ${safeDescription}
                        </div>
                        
                        <div class="analysis-section">
                            <div class="analysis-status">
                                <span class="status-dot ${statusClass}"></span>
                                ${statusText}
                            </div>
                            <div class="analysis-label">Analysis</div>
                            <div class="analysis-content" id="analysis-${safeIndex}">
                                ${analysisContent}
                            </div>
                        </div>
                    </div>
                    
                    <div class="article-actions">
                        <button class="btn btn-small" onclick="adminPanel.editAnalysis(${safeIndex})">✏️ Edit</button>
                        ${statusActions}
                        <button class="btn btn-small btn-secondary" onclick="window.open('${safeUrl}', '_blank')">🔗 View Original</button>
                        <button class="btn btn-small btn-danger" onclick="adminPanel.removeArticle(${safeIndex})">🗑️ Remove</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    this.currentFilter = filter;
};

AdminPanel.prototype.updateFilterCounts = function() {
    const published = this.articles.filter(a => a.status === 'published' || a.order <= 6).length;
    const drafts = this.articles.filter(a => a.status === 'draft').length;
    const queue = this.articles.filter(a => a.status === 'queue' || (!a.preGeneratedAnalysis && !a.order)).length;
    const rejected = this.articles.filter(a => a.status === 'rejected').length;
    
    const publishedBtn = document.getElementById('filter-published');
    const draftsBtn = document.getElementById('filter-drafts');
    const queueBtn = document.getElementById('filter-queue');
    const rejectedBtn = document.getElementById('filter-rejected');
    const allBtn = document.getElementById('filter-all');
    
    if (publishedBtn) publishedBtn.textContent = `Published (${published})`;
    if (draftsBtn) draftsBtn.textContent = `Drafts (${drafts})`;
    if (queueBtn) queueBtn.textContent = `Queue (${queue})`;
    if (rejectedBtn) rejectedBtn.textContent = `Rejected (${rejected})`;
    if (allBtn) allBtn.textContent = `All Articles (${this.articles.length})`;
};

AdminPanel.prototype.formatAnalysis = function(text) {
    if (!text) return '<em>No analysis available</em>';
    return text.split('\n\n').map(p => `<p>${this.escapeHtml(p)}</p>`).join('');
};

AdminPanel.prototype.updateStats = function() {
    const analyzed = this.articles.filter(a => a.preGeneratedAnalysis).length;
    const successRate = this.articles.length > 0 ? Math.round((analyzed / this.articles.length) * 100) : 0;
    
    const statFetched = document.getElementById('stat-fetched');
    const statAnalyzed = document.getElementById('stat-analyzed');
    const statSuccess = document.getElementById('stat-success');
    const statFallback = document.getElementById('stat-fallback');
    const statWords = document.getElementById('stat-words');
    const statSource = document.getElementById('stat-source');
    const statTotal = document.getElementById('stat-total');
    const statPublished = document.getElementById('stat-published');
    const statQueued = document.getElementById('stat-queued');
    
    // Core stats that exist in most layouts
    if (statTotal) statTotal.textContent = this.articles.length;
    if (statPublished) statPublished.textContent = this.articles.filter(a => a.status === 'published').length;
    if (statQueued) statQueued.textContent = this.articles.filter(a => a.status === 'queue').length;
    
    // Extended stats if elements exist
    if (statFetched) statFetched.textContent = this.articles.length;
    if (statAnalyzed) statAnalyzed.textContent = analyzed;
    if (statSuccess) statSuccess.textContent = `${successRate}%`;
    if (statFallback) statFallback.textContent = `${this.articles.length - analyzed}`;
    
    if (analyzed > 0 && statWords) {
        const avgWords = Math.round(
            this.articles
                .filter(a => a.preGeneratedAnalysis)
                .reduce((sum, a) => sum + (a.preGeneratedAnalysis.split(' ').length || 0), 0) / analyzed
        );
        statWords.textContent = avgWords;
    }
    
    if (statSource) {
        const sources = this.articles.map(a => a.source?.name).filter(Boolean);
        const topSource = sources.length > 0 ? 
            sources.reduce((a, b, i, arr) => 
                arr.filter(v => v === a).length >= arr.filter(v => v === b).length ? a : b
            ) : 'None';
        statSource.textContent = topSource;
    }
};

AdminPanel.prototype.editAnalysis = function(index) {
    const article = this.articles[index];
    const modal = document.getElementById('edit-modal');
    const editor = document.getElementById('analysis-editor');
    
    if (editor && modal) {
        editor.value = article.preGeneratedAnalysis || '';
        editor.dataset.articleIndex = index;
        modal.style.display = 'block';
    }
};

AdminPanel.prototype.promoteArticle = function(index) {
    this.articles[index].status = 'published';
    this.articles[index].order = this.articles.filter(a => a.status === 'published').length;
    this.addLog('success', `Promoted article to published`);
    this.renderArticles(this.currentFilter);
    this.updateStats();
};

AdminPanel.prototype.demoteArticle = function(index) {
    this.articles[index].status = 'draft';
    delete this.articles[index].order;
    this.addLog('warning', `Demoted article to draft`);
    this.renderArticles(this.currentFilter);
    this.updateStats();
};

AdminPanel.prototype.removeArticle = function(index) {
    if (confirm('Remove this article from today\'s edition?')) {
        this.articles.splice(index, 1);
        this.renderArticles(this.currentFilter);
        this.addLog('warning', `Removed article ${index + 1}`);
        this.updateStats();
    }
};
