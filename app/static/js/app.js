/**
 * Pub/Sub Pretty Logger - Vue.js Frontend
 */

const { createApp, ref, computed, onMounted, nextTick, watch } = Vue;

const app = createApp({
    // Use custom delimiters to avoid conflicts with Jinja2
    ...window.vueDelimiters,
    setup() {
        // State
        const config = ref({
            project_id: '',
            subscription_id: ''
        });
        const messages = ref([]);
        const expandedMessages = ref({});
        const isConnected = ref(false);
        const isConnecting = ref(false);
        const connectionError = ref('');
        const socketInstance = ref(null);
        const clientId = ref('');
        const autoScroll = ref(true);
        const pauseMessages = ref(false);
        const maxMessages = ref(100);
        const messageFilter = ref('');
        const sidebarVisible = ref(false);
        const messagesContainer = ref(null);
        const jsonEditors = ref({});
        const currentMessageIndex = ref(0);
        const darkMode = ref(false);
        
        // Toast refs
        const toast = ref(null);
        const toastTitle = ref('');
        const toastMessage = ref('');
        const toastIcon = ref('fa-info-circle');

        // Dark Mode Methods
        const toggleDarkMode = () => {
            darkMode.value = !darkMode.value;
            if (darkMode.value) {
                document.body.classList.add('dark-mode');
            } else {
                document.body.classList.remove('dark-mode');
            }
            // Save preference to localStorage
            localStorage.setItem('darkMode', darkMode.value ? 'true' : 'false');
            
            // Update JSON editors theme if they exist
            Object.keys(jsonEditors.value).forEach(index => {
                if (jsonEditors.value[index]) {
                    try {
                        const editorOptions = darkMode.value ? 
                            { theme: 'ace/theme/monokai' } : 
                            { theme: 'ace/theme/github' };
                        jsonEditors.value[index].setOptions(editorOptions);
                    } catch (error) {
                        console.warn('Error updating JSON editor theme:', error);
                    }
                }
            });
        };
        
        // Load dark mode preference on start
        const loadDarkModePreference = () => {
            const savedMode = localStorage.getItem('darkMode');
            if (savedMode === 'true') {
                darkMode.value = true;
                document.body.classList.add('dark-mode');
            }
        };

        // Methods
        const loadDefaultConfig = async () => {
            try {
                const response = await fetch('/api/config');
                const data = await response.json();
                config.value.project_id = data.project_id;
                config.value.subscription_id = data.subscription_id;
            } catch (error) {
                showToast('Error', 'Failed to load default configuration', 'fa-exclamation-circle');
            }
        };

        const connectToPubSub = async () => {
            if (isConnected.value || isConnecting.value) return;
            
            isConnecting.value = true;
            connectionError.value = '';
            
            try {
                const response = await fetch('/api/connect', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        project_id: config.value.project_id,
                        subscription_id: config.value.subscription_id
                    })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    clientId.value = data.client_id;
                    isConnected.value = true;
                    showToast('Connected', 'Successfully connected to Pub/Sub', 'fa-check-circle');
                    // Try WebSocket first
                    initWebSocket();
                    // Also start polling as a fallback
                    startMessagePolling();
                } else {
                    connectionError.value = data.detail || 'Failed to connect';
                    showToast('Connection Error', connectionError.value, 'fa-exclamation-circle');
                }
            } catch (error) {
                connectionError.value = 'Network error, please try again';
                showToast('Connection Error', connectionError.value, 'fa-exclamation-circle');
            } finally {
                isConnecting.value = false;
            }
        };

        const initWebSocket = () => {
            if (socketInstance.value) {
                console.log('Closing existing WebSocket connection');
                socketInstance.value.close();
            }
            
            const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
            const wsUrl = `${wsProtocol}://${window.location.host}/api/ws/${clientId.value}`;
            console.log('Connecting to WebSocket URL:', wsUrl);
            
            const socket = new WebSocket(wsUrl);
            
            socket.onopen = () => {
                console.log('WebSocket connected successfully');
                connectionError.value = ''; // Clear any previous error
                showToast('WebSocket Connected', 'Successfully established WebSocket connection', 'fa-check-circle');
                
                // WebSocket is working, we can stop the polling fallback
                stopMessagePolling();
            };
            
            socket.onmessage = (event) => {
                console.log('WebSocket message received:', event.data);
                try {
                    const data = JSON.parse(event.data);
                    
                    if (data.type === 'message') {
                        console.log('Received Pub/Sub message:', data.data);
                        if (!pauseMessages.value) {
                            addMessage(data.data);
                        } else {
                            console.log('Message paused, not displaying');
                        }
                    } else if (data.type === 'status') {
                        console.log('Received status update:', data.data);
                        
                        if (data.data.error) {
                            console.error('Status contains error:', data.data.error);
                            connectionError.value = data.data.error;
                            isConnected.value = false;
                            showToast('Connection Error', data.data.error, 'fa-exclamation-circle');
                        } else if (data.data.status === 'connected') {
                            console.log('Status confirms connection');
                            isConnected.value = true;
                            connectionError.value = '';
                        }
                    }
                } catch (error) {
                    console.error('Error processing WebSocket message:', error, event.data);
                }
            };
            
            socket.onclose = (event) => {
                console.log('WebSocket disconnected:', event.code, event.reason);
                if (isConnected.value) {
                    isConnected.value = false;
                    showToast('Disconnected', `Connection to Pub/Sub was closed: ${event.reason || 'Unknown reason'}`, 'fa-times-circle');
                    // Try to reconnect after a brief delay
                    setTimeout(retryConnection, 3000);
                }
            };
            
            socket.onerror = (error) => {
                console.error('WebSocket error:', error);
                connectionError.value = 'WebSocket connection error';
                // We don't set isConnected to false here as onclose will be called anyway
                showToast('WebSocket Error', 'Error in WebSocket connection, will retry automatically', 'fa-exclamation-circle');
            };
            
            socketInstance.value = socket;
        };
        
        const retryConnection = () => {
            console.log('Attempting to reconnect WebSocket...');
            if (!isConnected.value && clientId.value) {
                initWebSocket();
                // Also poll for messages as a fallback
                startMessagePolling();
            }
        };

        // Fallback polling for messages if WebSocket fails
        let pollingInterval = null;
        const startMessagePolling = async () => {
            if (pollingInterval) clearInterval(pollingInterval);
            
            console.log('Starting fallback message polling');
            // Poll every 2 seconds
            pollingInterval = setInterval(async () => {
                if (!clientId.value) return;
                
                try {
                    const response = await fetch(`/api/messages/${clientId.value}`);
                    const data = await response.json();
                    
                    console.log(`Polled ${data.messages.length} messages, total ${data.total_available} available`);
                    
                    // Process messages if available
                    if (data.messages && data.messages.length > 0) {
                        console.log('Received messages via polling:', data.messages);
                        
                        // Only display if not paused
                        if (!pauseMessages.value) {
                            data.messages.forEach(message => {
                                // Check if we already have this message by ID
                                const messageId = message.message_id;
                                const exists = messages.value.some(m => 
                                    m.data && m.data.message_id === messageId
                                );
                                
                                if (!exists) {
                                    addMessage(message);
                                }
                            });
                        }
                    }
                } catch (error) {
                    console.error('Error polling messages:', error);
                }
            }, 2000);
        };

        const stopMessagePolling = () => {
            if (pollingInterval) {
                console.log('Stopping fallback message polling');
                clearInterval(pollingInterval);
                pollingInterval = null;
            }
        };

        const addMessage = (message) => {
            // Add message to front of the array (newest first)
            messages.value.unshift({
                data: message,
                timestamp: new Date().toISOString()
            });
            
            // Limit the number of messages if needed
            if (maxMessages.value > 0 && messages.value.length > maxMessages.value) {
                // Also remove the editor if it exists
                const removed = messages.value.splice(maxMessages.value);
                removed.forEach(msg => {
                    const idx = messages.value.length;
                    if (jsonEditors.value[`json-${idx}`]) {
                        jsonEditors.value[`json-${idx}`].destroy();
                        delete jsonEditors.value[`json-${idx}`];
                    }
                });
            }
            
            // Close all other messages and auto-expand only the newest one
            Object.keys(expandedMessages.value).forEach(key => {
                expandedMessages.value[key] = false;
            });
            expandedMessages.value[0] = true;
            
            // Initialize JSON editor for the new message after DOM update
            nextTick(() => {
                initJsonEditor(0, message.data);
            });
            
            // Auto-scroll if enabled
            if (autoScroll.value) {
                nextTick(() => {
                    if (messagesContainer.value) {
                        messagesContainer.value.scrollTop = 0;
                    }
                });
            }
        };

        const clearMessages = () => {
            // Destroy all JSON editors first
            Object.values(jsonEditors.value).forEach(editor => {
                if (editor && typeof editor.destroy === 'function') {
                    editor.destroy();
                }
            });
            
            messages.value = [];
            expandedMessages.value = {};
            jsonEditors.value = {};
        };

        const toggleMessageExpanded = (index) => {
            const newValue = !expandedMessages.value[index];
            
            // First close all messages
            Object.keys(expandedMessages.value).forEach(key => {
                expandedMessages.value[key] = false;
            });
            
            // Then open just the clicked one if it was closed
            expandedMessages.value[index] = newValue;
            
            if (newValue) {
                // Initialize JSON editor if this is the first time expanding
                nextTick(() => {
                    initJsonEditor(index, messages.value[index].data.data);
                });
            }
        };

        const isMessageExpanded = (index) => {
            return !!expandedMessages.value[index];
        };

        const initJsonEditor = (index, data) => {
            // Create a container for the editor
            const container = document.getElementById(`json-${index}`);
            
            if (!container) {
                console.error(`Container for JSON editor #${index} not found`);
                return;
            }
            
            try {
                // Create the editor
                const options = {
                    mode: 'view',
                    modes: ['view', 'tree'],
                    theme: darkMode.value ? 'ace/theme/monokai' : 'ace/theme/github'
                };
                
                const editor = new JSONEditor(container, options);
                
                // Set the data
                editor.set(data);
                
                // Store the editor reference
                jsonEditors.value[index] = editor;
                
                // Force a redraw to ensure proper rendering
                setTimeout(() => {
                    if (jsonEditors.value[index]) {
                        jsonEditors.value[index].refresh();
                    }
                }, 100);
            } catch (error) {
                console.error('Failed to initialize JSONEditor:', error);
                
                // Fallback to syntax-highlighted pre/code
                container.innerHTML = '';
                container.classList.add('hljs');
                container.textContent = JSON.stringify(data, null, 2);
                
                // Apply syntax highlighting
                hljs.highlightElement(container);
            }
        };

        const getMessageType = (msg) => {
            // Detect message type based on content
            try {
                const data = msg.data.data;
                
                if (typeof data === 'object') {
                    if (data.type) {
                        // Use the type field if available
                        return data.type.toUpperCase();
                    } else if (data.notificationType) {
                        return data.notificationType.toUpperCase();
                    } else if (data.messageType) {
                        return data.messageType.toUpperCase();
                    } else if (data.event) {
                        return data.event.toUpperCase();
                    }
                }
                
                // Try to infer from structure
                if (data.email || data.emailTemplate || data.destinations) {
                    return 'EMAIL';
                } else if (data.notification || data.alert) {
                    return 'NOTIFICATION';
                } else if (data.error || data.errorMessage) {
                    return 'ERROR';
                }
                
                // If we can't determine, check attributes
                const attrs = msg.data.attributes || {};
                if (attrs.type) {
                    return attrs.type.toUpperCase();
                } else if (attrs.eventType) {
                    return attrs.eventType.toUpperCase();
                }
                
                return '';
            } catch (e) {
                return '';
            }
        };

        const formatTimestamp = (timestamp) => {
            if (!timestamp) return '';
            
            try {
                const date = new Date(timestamp);
                return date.toLocaleString();
            } catch (e) {
                return timestamp;
            }
        };

        const copyMessageToClipboard = (msg) => {
            try {
                const jsonStr = JSON.stringify(msg.data, null, 2);
                navigator.clipboard.writeText(jsonStr).then(() => {
                    showToast('Copied', 'Message copied to clipboard', 'fa-clipboard-check');
                });
            } catch (e) {
                console.error('Failed to copy to clipboard:', e);
                showToast('Error', 'Failed to copy to clipboard', 'fa-exclamation-circle');
            }
        };

        const toggleSidebar = () => {
            sidebarVisible.value = !sidebarVisible.value;
        };

        const showToast = (title, message, icon = 'fa-info-circle') => {
            toastTitle.value = title;
            toastMessage.value = message;
            toastIcon.value = icon;
            
            try {
                // Try to use Bootstrap's toast if available
                if (typeof bootstrap !== 'undefined' && bootstrap.Toast) {
                    const toastElement = new bootstrap.Toast(toast.value, {
                        delay: 3000
                    });
                    toastElement.show();
                } else {
                    // Fallback to manual show/hide
                    console.log('Bootstrap not available, using fallback toast');
                    
                    // Make sure we have the toast element
                    if (toast.value) {
                        // Add show class
                        toast.value.classList.add('show');
                        
                        // Auto-hide after 3 seconds
                        setTimeout(() => {
                            toast.value.classList.remove('show');
                        }, 3000);
                    } else {
                        // Last resort: console
                        console.log(`Toast: ${title} - ${message}`);
                    }
                }
            } catch (e) {
                console.error('Error showing toast:', e);
                console.log(`Toast: ${title} - ${message}`);
            }
        };

        const hideToast = () => {
            try {
                if (typeof bootstrap !== 'undefined' && bootstrap.Toast) {
                    // Use Bootstrap if available
                    const toastElement = bootstrap.Toast.getInstance(toast.value);
                    if (toastElement) {
                        toastElement.hide();
                    }
                } else if (toast.value) {
                    // Manual fallback
                    toast.value.classList.remove('show');
                }
            } catch (e) {
                console.error('Error hiding toast:', e);
            }
        };

        // Computed
        const filteredMessages = computed(() => {
            if (!messageFilter.value) return messages.value;
            
            const filter = messageFilter.value.toLowerCase();
            return messages.value.filter(msg => {
                try {
                    const jsonStr = JSON.stringify(msg.data).toLowerCase();
                    return jsonStr.includes(filter);
                } catch (e) {
                    return false;
                }
            });
        });

        // Navigate between messages
        const navigateMessage = (direction) => {
            const filteredMsgs = filteredMessages.value;
            if (filteredMsgs.length === 0) return;
            
            // Find the currently expanded message index in the filtered list
            let currentExpandedIndex = -1;
            for (let i = 0; i < filteredMsgs.length; i++) {
                if (isMessageExpanded(i)) {
                    currentExpandedIndex = i;
                    break;
                }
            }
            
            // Calculate the new index
            let newIndex;
            if (currentExpandedIndex === -1) {
                // If no message is expanded, start with the first or last
                newIndex = direction > 0 ? 0 : filteredMsgs.length - 1;
            } else {
                newIndex = currentExpandedIndex + direction;
                // Handle wrapping around the ends
                if (newIndex < 0) newIndex = filteredMsgs.length - 1;
                if (newIndex >= filteredMsgs.length) newIndex = 0;
            }
            
            // Update the current message index for display
            currentMessageIndex.value = newIndex;
            
            // Expand the new message
            toggleMessageExpanded(newIndex);
        };

        // Lifecycle hooks
        onMounted(() => {
            loadDefaultConfig();
            
            // Set up references
            messagesContainer.value = document.getElementById('messages-container');
            
            // Initialize bootstrap components
            document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => {
                new bootstrap.Tooltip(el);
            });
            
            // Initialize highlight.js
            if (typeof hljs !== 'undefined') {
                hljs.configure({
                    languages: ['json']
                });
                hljs.highlightAll();
                console.log('highlight.js initialized');
            } else {
                console.warn('highlight.js is not available');
            }
            
            // Load dark mode preference
            loadDarkModePreference();
        });

        // Return all reactive data and methods for the template
        return {
            config,
            messages,
            isConnected,
            isConnecting,
            connectionError,
            autoScroll,
            pauseMessages,
            maxMessages,
            messageFilter,
            sidebarVisible,
            messagesContainer,
            toast,
            toastTitle,
            toastMessage,
            toastIcon,
            darkMode,
            currentMessageIndex,
            filteredMessages,
            
            connectToPubSub,
            clearMessages,
            toggleMessageExpanded,
            isMessageExpanded,
            getMessageType,
            formatTimestamp,
            copyMessageToClipboard,
            toggleSidebar,
            showToast,
            hideToast,
            startMessagePolling,
            stopMessagePolling,
            navigateMessage,
            toggleDarkMode
        };
    }
}).mount('#app'); 