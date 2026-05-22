'use strict';

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install' || details.reason === 'update') {
        chrome.storage.local.get(['backendUrl'], (items) => {
            if (!items.backendUrl) {
                chrome.storage.local.set({
                    // Set to your backend URL (e.g., https://your-northflank-service.run)
                    backendUrl: 'http://localhost:3000',
                    authToken: '',
                    cvContent: '',
                    cvFilename: '',
                    theme: 'dark',
                    sessionsHistory: []
                });
            }
        });
    }
});
