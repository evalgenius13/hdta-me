// admin-init.js - Complete working version with full functionality - UPDATED with trends support

// Global UI functions
function showTab(tabName) {
    // Hide all panels
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    
    // Show selected panel and tab
    const panel = document.getElementById(`${tabName}-panel`);
    if (panel) {
        panel.classList.add('active');
    }
    
    // Find and activate the correct tab button
    const tabButtons = document.querySelectorAll('.tab');
    tabButtons.forEach(tab => {
        if (tab.textContent.includes(getTabDisplayName(tabName))) {
            tab.classList.add('active');
        }
    });
}

function getTabDisplayName(tabName) {
    const tabNames = {
        'articles': '📰',
        'trends': '📊',
        'logs': '📋'
    };
    return tabNames[tabName] || tabName;
}

function filterArticles(filter) {
    // Update button states
    document.querySelectorAll('.article-filter-tabs button').forEach(btn => {
        btn.classList.remove('btn-secondary');
        btn.classList.add('btn-secondary');
    });
    
    const filterBtn = document.getElementById(`filter-${filter}`);
    if (filterBtn) {
        filterBtn.classList.remove('btn-secondary');
    }
    
    if (window.adminPanel) {
        adminPanel.renderArticles(filter);
    }
}

// Main action functions
async function triggerUpdate(event) {
    // Handle both button clicks and direct calls
    const btn = event?.target || document.querySelector('button[onclick*="triggerUpdate"]');
    
    console.log('🚀 Starting manual trigger...');
    
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Updating...';
    }
    
    if (window.adminPanel) {
        adminPanel.addLog('info', 'Manual update triggered');
    }
    
    try {
        // First try the admin regenerate endpoint
        console.log('📡 Trying admin regenerate endpoint...');
        const response = await fetch(`/api/admin?action=regenerate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${window.adminPanel?.adminKey || 'hdta-admin-2025-temp'}`
            },
            body: JSON.stringify({})
        });
        
        console.log('📊 Admin regenerate response status:', response.status);
        
        if (response.ok) {
            const data = await response.json();
            console.log('✅ Admin regenerate response:', data);
            
            if (data.success) {
                const message = `Update completed - ${data.processing?.articles_processed || 0} articles processed (${data.processing?.success_rate || 0}% success rate)`;
                console.log('✅ ' + message);
                
                if (window.adminPanel) {
                    adminPanel.addLog('success', message);
                    await adminPanel.loadData();
                    adminPanel.updateStats();
                }
            } else {
                throw new Error(data.error || 'Admin regenerate returned success=false');
            }
        } else {
            throw new Error(`Admin regenerate HTTP ${response.status}: ${response.statusText}`);
        }
        
    } catch (adminError) {
        console.warn('⚠️ Admin regenerate failed, trying manual trigger:', adminError.message);
        
        if (window.adminPanel) {
            adminPanel.addLog('warning', 'Admin regenerate failed, trying manual trigger: ' + adminError.message);
        }
        
        // Fallback to manual trigger endpoint
        try {
            console.log('🔄 Trying manual trigger endpoint...');
            const fallbackResponse = await fetch(`/api/manual-trigger`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ trigger_key: 'force-update-2025' })
            });
            
            console.log('📊 Manual trigger response status:', fallbackResponse.status);
            
            if (!fallbackResponse.ok) {
                const errorText = await fallbackResponse.text();
                throw new Error(`Manual trigger HTTP ${fallbackResponse.status}: ${errorText}`);
            }
            
            const fallbackData = await fallbackResponse.json();
            console.log('✅ Manual trigger response:', fallbackData);
            
            if (fallbackData.success) {
                const message = `Manual trigger successful - ${fallbackData.processing?.articles_processed || 0} articles processed`;
                console.log('✅ ' + message);
                
                if (window.adminPanel) {
                    adminPanel.addLog('success', message);
                    await adminPanel.loadData();
                    adminPanel.updateStats();
                }
            } else {
                throw new Error(fallbackData.error || 'Manual trigger returned success=false');
            }
            
        } catch (fallbackError) {
            console.error('❌ Both admin and manual triggers failed:', fallbackError);
            
            if (window.adminPanel) {
                adminPanel.addLog('error', 'Both triggers failed: ' + fallbackError.message);
            }
            
            throw fallbackError;
        }
    }
    
    // Re-enable button
    if (btn) {
        btn.disabled = false;
        btn.textContent = '🚀 Force Update Today';
    }
}

async function forceRefetch() {
    console.log('🚀 Force refetching news...');
    
    if (window.adminPanel) {
        adminPanel.addLog('info', 'Force refetching news with fresh articles...');
    }
    
    try {
        const response = await fetch(`/api/manual-trigger`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                trigger_key: 'force-update-2025',
                force_refetch: true 
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            console.log('✅ Force refetch response:', data);
            
            if (window.adminPanel) {
                adminPanel.addLog('success', 'Fresh articles fetched and processed');
                await adminPanel.loadData();
                adminPanel.updateStats();
            }
        } else {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
    } catch (error) {
        console.error('❌ Failed to force refetch:', error);
        
        if (window.adminPanel) {
            adminPanel.addLog('error', 'Failed to force refetch: ' + error.message);
        }
    }
}

async function testWithMock() {
    console.log('🧪 Testing with mock data...');
    
    if (window.adminPanel) {
        adminPanel.addLog('info', 'Creating mock test data...');
    }
    
    try {
        const response = await fetch(`/api/manual-trigger`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                trigger_key: 'force-update-2025',
                mock_data: true 
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            console.log('✅ Mock test response:', data);
            
            if (window.adminPanel) {
                adminPanel.addLog('success', 'Mock data created successfully');
                await adminPanel.loadData();
                adminPanel.updateStats();
            }
        } else {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
    } catch (error) {
        console.error('❌ Failed to create mock data:', error);
        
        if (window.adminPanel) {
            adminPanel.addLog('error', 'Failed to create mock data: ' + error.message);
        }
    }
}

async function refreshData() {
    console.log('🔄 Refreshing data...');
    
    if (window.adminPanel) {
        adminPanel.addLog('info', 'Refreshing data...');
        await adminPanel.loadData();
        adminPanel.updateStats();
        adminPanel.addLog('success', 'Data refreshed');
    } else {
        console.error('AdminPanel not available');
    }
}

async function clearToday() {
    if (!confirm('Clear today\'s edition? This cannot be undone.')) {
        return;
    }
    
    console.log('🗑️ Clearing today\'s edition...');
    
    if (window.adminPanel) {
        adminPanel.addLog('warning', 'Clearing today\'s edition...');
    }
    
    try {
        const response = await fetch(`/api/admin?action=clear-today`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${window.adminPanel?.adminKey || 'hdta-admin-2025-temp'}`
            },
            body: JSON.stringify({})
        });
        
        if (response.ok) {
            const data = await response.json();
            console.log('✅ Clear today response:', data);
            
            if (window.adminPanel) {
                adminPanel.articles = [];
                adminPanel.renderArticles();
                adminPanel.updateStats();
                adminPanel.addLog('success', 'Today\'s edition cleared');
            }
        } else {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
    } catch (error) {
        console.error('❌ Failed to clear edition:', error);
        
        if (window.adminPanel) {
            adminPanel.addLog('error', 'Failed to clear edition: ' + error.message);
        }
    }
}

// Preview functions
function togglePreviewMode(mode) {
    const frame = document.getElementById('preview-frame');
    const container = document.getElementById('preview-container');
    
    if (!frame || !container) {
        console.warn('Preview elements not found');
        return;
    }
    
    if (mode === 'mobile') {
        frame.style.width = '375px';
        frame.style.margin = '0 auto';
        container.style.textAlign = 'center';
        console.log('📱 Switched to mobile preview mode');
        
        if (window.adminPanel) {
            adminPanel.addLog('info', 'Switched to mobile preview mode');
        }
    } else {
        frame.style.width = '100%';
        frame.style.margin = '0';
        container.style.textAlign = 'left';
        console.log('🖥️ Switched to desktop preview mode');
        
        if (window.adminPanel) {
            adminPanel.addLog('info', 'Switched to desktop preview mode');
        }
    }
}

function refreshPreview() {
    const frame = document.getElementById('preview-frame');
    if (frame) {
        frame.src = '/?preview=true&t=' + Date.now();
        console.log('🔄 Preview refreshed');
        
        if (window.adminPanel) {
            adminPanel.addLog('info', 'Preview refreshed');
        }
    }
}

// Utility functions
function refreshLogs() {
    console.log('🔄 Logs refreshed');
    if (window.adminPanel) {
        adminPanel.addLog('info', 'Logs refreshed');
    }
}

function clearLogs() {
    const logsContainer = document.getElementById('logs-container');
    if (logsContainer) {
        logsContainer.innerHTML = '';
        console.log('🗑️ Logs cleared');
        if (window.adminPanel) {
            adminPanel.addLog('info', 'Logs cleared');
        }
    }
}

function saveSettings() {
    if (window.adminPanel) {
        adminPanel.saveSettings();
    }
}

function resetSettings() {
    if (window.adminPanel) {
        adminPanel.resetSettings();
    }
}

function closeModal() {
    const modal = document.getElementById('edit-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Console testing helpers
function testTrigger() {
    console.log('🧪 Testing trigger from console...');
    return triggerUpdate();
}

function testAdminAPI() {
    console.log('🧪 Testing admin API...');
    return fetch(`/api/admin?action=get-articles`, {
        headers: { 'Authorization': `Bearer ${window.adminPanel?.adminKey || 'hdta-admin-2025-temp'}` }
    }).then(r => r.json()).then(data => {
        console.log('📊 Admin API response:', data);
        return data;
    }).catch(error => {
        console.error('❌ Admin API failed:', error);
        throw error;
    });
}

function testPublicAPI() {
    console.log('🧪 Testing public API...');
    return fetch(`/api/fetch-news`)
        .then(r => r.json()).then(data => {
            console.log('📊 Public API response:', data);
            return data;
        }).catch(error => {
            console.error('❌ Public API failed:', error);
            throw error;
        });
}

// Initialize admin panel
let adminPanel;

document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Initializing admin panel...');
    
    try {
        // Create admin panel instance
        if (typeof AdminPanel !== 'undefined') {
            adminPanel = new AdminPanel();
            window.adminPanel = adminPanel; // Make globally available
            
            console.log('📋 Admin panel instance created');
            
            // Initialize the panel
            await adminPanel.init();
            
            // Populate settings form
            if (typeof adminPanel.populateSettingsForm === 'function') {
                adminPanel.populateSettingsForm();
            }
            
            // Initialize preview
            refreshPreview();
            
            // Load saved prompts
            const savedSystemPrompt = localStorage.getItem('hdta-custom-system-prompt');
            const savedUserPrompt = localStorage.getItem('hdta-custom-user-prompt');
            
            const systemPromptEditor = document.getElementById('prompt-editor');
            const userPromptEditor = document.getElementById('user-prompt-editor');
            
            if (savedSystemPrompt && systemPromptEditor) {
                systemPromptEditor.value = savedSystemPrompt;
                console.log('📝 Loaded saved system prompt');
            }
            if (savedUserPrompt && userPromptEditor) {
                userPromptEditor.value = savedUserPrompt;
                console.log('📝 Loaded saved user prompt');
            }
            
            adminPanel.addLog('success', 'Admin panel initialized - weekly workflow with trends');
            console.log('✅ Admin panel initialization completed');
            
        } else {
            throw new Error('AdminPanel class not found - make sure admin-core.js is loaded first');
        }
        
    } catch (error) {
        console.error('❌ Failed to initialize admin panel:', error);
        
        // Show error in UI if possible
        const loadingEl = document.getElementById('articles-loading');
        if (loadingEl) {
            loadingEl.innerHTML = `
                <div style="color: #dc2626; text-align: center; padding: 20px;">
                    <div style="font-size: 18px; margin-bottom: 8px;">⚠️ Admin Panel Failed to Initialize</div>
                    <div style="font-size: 14px; opacity: 0.8;">${error.message}</div>
                    <button class="btn" onclick="location.reload()" style="margin-top: 12px;">🔄 Reload Page</button>
                </div>
            `;
        }
        
        // Try to create a basic log function if adminPanel failed
        if (!window.adminPanel) {
            window.adminPanel = {
                addLog: function(level, message) {
                    console.log(`[${level.toUpperCase()}] ${message}`);
                }
            };
            adminPanel.addLog('error', 'Failed to initialize: ' + error.message);
        }
    }
});

// Bind modal saveAnalysis globally for the modal button
window.saveAnalysis = function() { 
    if (window.adminPanel && typeof adminPanel.saveAnalysis === 'function') {
        adminPanel.saveAnalysis(); 
    } else {
        console.error('saveAnalysis method not available');
    }
};

// Global error handling
window.addEventListener('error', function(e) {
    console.error('🚨 Global JavaScript error:', e);
    
    if (window.adminPanel && typeof adminPanel.addLog === 'function') {
        adminPanel.addLog('error', `JavaScript error: ${e.message}`);
    }
});

// Unhandled promise rejection handling
window.addEventListener('unhandledrejection', function(e) {
    console.error('🚨 Unhandled promise rejection:', e);
    
    if (window.adminPanel && typeof adminPanel.addLog === 'function') {
        adminPanel.addLog('error', `Promise rejection: ${e.reason}`);
    }
});

// Export for debugging - make functions globally available
window.triggerUpdate = triggerUpdate;
window.forceRefetch = forceRefetch;
window.testWithMock = testWithMock;
window.refreshData = refreshData;
window.clearToday = clearToday;
window.testTrigger = testTrigger;
window.testAdminAPI = testAdminAPI;
window.testPublicAPI = testPublicAPI;

console.log('📋 Admin init script loaded - weekly workflow with trends support');
