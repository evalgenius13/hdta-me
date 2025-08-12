// admin-core.js - Core AdminPanel functionality
class AdminPanel {
    constructor() {
        this.API_BASE = 'https://hdta-me.vercel.app';
        this.articles = [];
        this.settings = this.loadSettings();
        this.adminKey = 'hdta-admin-2025-temp'; // Change this in production
        this.currentFilter = 'all';
    }

    async init() {
        await this.loadData();
        this.updateStats();
    }

    async loadData() {
        try {
            const response = await fetch(`${this.API_BASE}/api/admin?action=get-articles`, {
                headers: {
                    'Authorization': `Bearer ${this.adminKey}`
                }
            });
            
            if (!response.ok) {
                if (response.status === 401) {
                    throw new Error('Unauthorized - Check admin key');
                }
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            this.articles = data.articles || [];
            
            if (data.edition) {
                const info = data.edition;
                document.getElementById('edition-info').textContent = 
                    `Issue #${info.issue_number} • ${info.date} (${info.status})`;
            } else {
                document.getElementById('edition-info').textContent = 'No edition found for today';
            }
            
            this.renderArticles();
            document.getElementById('articles-loading').style.display = 'none';
            document.getElementById('articles-grid').style.display = 'grid';
            
        } catch (error) {
            console.error('Failed to load data:', error);
            this.addLog('error', 'Failed to load articles: ' + error.message);
            
            // Fallback to public API if admin fails
            if (error.message.includes('Unauthorized')) {
                this.addLog('warning', 'Falling back to public API...');
                await this.loadPublicData();
            }
        }
    }

    async loadPublicData() {
        try {
            const response = await fetch(`${this.API_BASE}/api/fetch-news`);
            const data = await response.json();
            
            this.articles = data.articles || [];
            
            if (data.edition_info) {
                const info = data.edition_info;
                document.getElementById('edition-info').textContent = 
                    `Issue #${info.issue_number} • ${info.date} (Public View)`;
            }
            
            this.renderArticles();
            document.getElementById('articles-loading').style.display = 'none';
            document.getElementById('articles-grid').style.display = 'grid';
            
        } catch (error) {
            console.error('Failed to load public data:', error);
            this.addLog('error', 'Failed to load public data: ' + error.message);
        }
    }

    loadSettings() {
        const defaults = {
            maxArticles: 6,
            daysBack: 3,
            minScore: 10,
            wordMin: 100,
            wordMax: 250,
            temperature: 0.4,
            similarity: 0.75,
            autoPublish: true
        };
        
        try {
            const saved = localStorage.getItem('hdta-admin-settings');
            return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
        } catch {
            return defaults;
        }
    }

    saveSettings() {
        const settings = {
            maxArticles: parseInt(document.getElementById('max-articles').value),
            daysBack: parseInt(document.getElementById('days-back').value),
            minScore: parseInt(document.getElementById('min-score').value),
            wordMin: parseInt(document.getElementById('word-min').value),
            wordMax: parseInt(document.getElementById('word-max').value),
            temperature: parseFloat(document.getElementById('temperature').value),
            similarity: parseFloat(document.getElementById('similarity').value),
            autoPublish: document.getElementById('auto-publish').checked
        };
        
        localStorage.setItem('hdta-admin-settings', JSON.stringify(settings));
        this.settings = settings;
        this.addLog('success', 'Settings saved successfully');
    }

    resetSettings() {
        localStorage.removeItem('hdta-admin-settings');
        this.settings = this.loadSettings();
        this.populateSettingsForm();
        this.addLog('info', 'Settings reset to defaults');
    }

    populateSettingsForm() {
        document.getElementById('max-articles').value = this.settings.maxArticles;
        document.getElementById('days-back').value = this.settings.daysBack;
        document.getElementById('min-score').value = this.settings.minScore;
        document.getElementById('word-min').value = this.settings.wordMin;
        document.getElementById('word-max').value = this.settings.wordMax;
        document.getElementById('temperature').value = this.settings.temperature;
        document.getElementById('similarity').value = this.settings.similarity;
        document.getElementById('auto-publish').checked = this.settings.autoPublish;
    }

    addLog(type, message) {
        const logs = document.getElementById('logs-container');
        const time = new Date().toLocaleTimeString();
        const logClass = type === 'error' ? 'log-error' : 
                        type === 'success' ? 'log-success' : 
                        type === 'warning' ? 'log-warning' : '';
        
        const logLine = document.createElement('div');
        logLine.className = `log-line ${logClass}`;
        logLine.textContent = `[${time}] ${message}`;
        
        logs.appendChild(logLine);
        logs.scrollTop = logs.scrollHeight;
    }

    getTimeAgo(publishedAt) {
        if (!publishedAt) return 'Unknown time';
        const now = new Date();
        const pub = new Date(publishedAt);
        const hours = Math.floor((now - pub) / 3600000);
        const days = Math.floor(hours / 24);
        
        if (hours < 1) return 'Just published';
        if (hours < 24) return `${hours}h ago`;
        if (days === 1) return 'Yesterday';
        if (days < 7) return `${days}d ago`;
        return pub.toLocaleDateString();
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    closeModal() {
        document.getElementById('edit-modal').style.display = 'none';
    }
}
