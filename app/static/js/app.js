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
        const isConnecting = ref(false);
        const connectionError = ref('');
        const socketInstances = ref({});  // Map of client_id to WebSocket instance
        const activeSubscriptions = ref([]); // Array of subscription objects
        const autoScroll = ref(true);
        const pauseMessages = ref(false);
        const maxMessages = ref(100);
        const messageFilter = ref('');
        const sidebarVisible = ref(false);
        const messagesContainer = ref(null);
        const jsonEditors = ref({});
        const currentMessageIndex = ref(0);
        const darkMode = ref(false);
        
        // Autocomplete state
        const projects = ref([]);
        const subscriptions = ref([]);
        const filteredProjects = ref([]);
        const filteredSubscriptions = ref([]);
        const showProjectSuggestions = ref(false);
        const showSubscriptionSuggestions = ref(false);
        const loadingProjects = ref(false);
        const loadingSubscriptions = ref(false);
        
        // Keyboard navigation for autocomplete
        const selectedProjectIndex = ref(-1);
        const selectedSubscriptionIndex = ref(-1);
        
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

        // Autocomplete methods
        const fetchProjects = async () => {
            if (projects.value.length > 0) {
                showProjectSuggestions.value = true;
                selectedProjectIndex.value = -1;  // Reset selection index when showing suggestions
                return;
            }
            
            loadingProjects.value = true;
            showProjectSuggestions.value = false;
            
            try {
                const response = await fetch('/api/projects');
                const data = await response.json();
                
                projects.value = data.projects || [];
                filteredProjects.value = [...projects.value];
                
                if (projects.value.length > 0) {
                    showProjectSuggestions.value = true;
                    selectedProjectIndex.value = -1;  // Reset selection index when showing suggestions
                }
            } catch (error) {
                console.error('Error fetching projects:', error);
                showToast('Error', 'Failed to fetch GCP projects', 'fa-exclamation-circle');
            } finally {
                loadingProjects.value = false;
            }
        };
        
        const fetchSubscriptions = async () => {
            if (!config.value.project_id) {
                showToast('Info', 'Please select a project first', 'fa-info-circle');
                return;
            }
            
            if (subscriptions.value.length > 0 && 
                subscriptions.value[0].project_id === config.value.project_id) {
                showSubscriptionSuggestions.value = true;
                selectedSubscriptionIndex.value = -1;  // Reset selection index when showing suggestions
                return;
            }
            
            loadingSubscriptions.value = true;
            showSubscriptionSuggestions.value = false;
            
            try {
                const response = await fetch(`/api/subscriptions/${config.value.project_id}`);
                const data = await response.json();
                
                subscriptions.value = data.subscriptions || [];
                filteredSubscriptions.value = [...subscriptions.value];
                
                if (subscriptions.value.length > 0) {
                    // Add project_id to each subscription for reference
                    subscriptions.value.forEach(sub => {
                        sub.project_id = config.value.project_id;
                    });
                    showSubscriptionSuggestions.value = true;
                    selectedSubscriptionIndex.value = -1;  // Reset selection index when showing suggestions
                }
            } catch (error) {
                console.error('Error fetching subscriptions:', error);
                showToast('Error', 'Failed to fetch Pub/Sub subscriptions', 'fa-exclamation-circle');
            } finally {
                loadingSubscriptions.value = false;
            }
        };
        
        // Handle keyboard events for Project ID autocomplete
        const handleProjectKeydown = (event) => {
            if (!showProjectSuggestions.value || filteredProjects.value.length === 0) return;
            
            if (event.key === 'ArrowDown') {
                event.preventDefault(); // Prevent scrolling
                if (selectedProjectIndex.value < filteredProjects.value.length - 1) {
                    selectedProjectIndex.value++;
                } else {
                    selectedProjectIndex.value = 0; // Loop back to first item
                }
                console.log("Down arrow pressed, selected index:", selectedProjectIndex.value);
            } 
            else if (event.key === 'ArrowUp') {
                event.preventDefault(); // Prevent scrolling
                if (selectedProjectIndex.value > 0) {
                    selectedProjectIndex.value--;
                } else {
                    selectedProjectIndex.value = filteredProjects.value.length - 1; // Loop to last item
                }
                console.log("Up arrow pressed, selected index:", selectedProjectIndex.value);
            } 
            else if (event.key === 'Enter' && selectedProjectIndex.value >= 0) {
                event.preventDefault(); // Prevent form submission
                const selected = filteredProjects.value[selectedProjectIndex.value];
                console.log("Enter pressed, selecting project:", selected);
                selectProject(selected);
            }
            else if (event.key === 'Escape') {
                showProjectSuggestions.value = false;
                console.log("Escape pressed, hiding suggestions");
            }
        };
        
        // Handle keyboard events for Subscription ID autocomplete
        const handleSubscriptionKeydown = (event) => {
            if (!showSubscriptionSuggestions.value || filteredSubscriptions.value.length === 0) return;
            
            if (event.key === 'ArrowDown') {
                event.preventDefault(); // Prevent scrolling
                if (selectedSubscriptionIndex.value < filteredSubscriptions.value.length - 1) {
                    selectedSubscriptionIndex.value++;
                } else {
                    selectedSubscriptionIndex.value = 0; // Loop back to first item
                }
                console.log("Down arrow pressed, selected subscription index:", selectedSubscriptionIndex.value);
            } 
            else if (event.key === 'ArrowUp') {
                event.preventDefault(); // Prevent scrolling
                if (selectedSubscriptionIndex.value > 0) {
                    selectedSubscriptionIndex.value--;
                } else {
                    selectedSubscriptionIndex.value = filteredSubscriptions.value.length - 1; // Loop to last item
                }
                console.log("Up arrow pressed, selected subscription index:", selectedSubscriptionIndex.value);
            } 
            else if (event.key === 'Enter' && selectedSubscriptionIndex.value >= 0) {
                event.preventDefault(); // Prevent form submission
                const selected = filteredSubscriptions.value[selectedSubscriptionIndex.value];
                console.log("Enter pressed, selecting subscription:", selected);
                selectSubscription(selected);
            }
            else if (event.key === 'Escape') {
                showSubscriptionSuggestions.value = false;
                console.log("Escape pressed, hiding subscription suggestions");
            }
        };

        const projectInputChanged = () => {
            if (!config.value.project_id) {
                showProjectSuggestions.value = false;
                return;
            }
            
            const query = config.value.project_id.toLowerCase();
            filteredProjects.value = projects.value.filter(project => 
                project.id.toLowerCase().includes(query) || 
                (project.name && project.name.toLowerCase().includes(query))
            );
            
            showProjectSuggestions.value = filteredProjects.value.length > 0;
            selectedProjectIndex.value = -1; // Reset selection when input changes
        };
        
        const subscriptionInputChanged = () => {
            if (!config.value.subscription_id) {
                showSubscriptionSuggestions.value = false;
                return;
            }
            
            const query = config.value.subscription_id.toLowerCase();
            filteredSubscriptions.value = subscriptions.value.filter(subscription => 
                subscription.id.toLowerCase().includes(query) || 
                subscription.topic.toLowerCase().includes(query)
            );
            
            showSubscriptionSuggestions.value = filteredSubscriptions.value.length > 0;
            selectedSubscriptionIndex.value = -1; // Reset selection when input changes
        };
        
        const selectProject = (project) => {
            config.value.project_id = project.id;
            showProjectSuggestions.value = false;
            selectedProjectIndex.value = -1;
            
            // Clear subscriptions when project changes
            subscriptions.value = [];
            filteredSubscriptions.value = [];
            config.value.subscription_id = '';
        };
        
        const selectSubscription = (subscription) => {
            config.value.subscription_id = subscription.id;
            showSubscriptionSuggestions.value = false;
            selectedSubscriptionIndex.value = -1;
        };

        // Close suggestions when clicking outside
        document.addEventListener('click', (event) => {
            if (!event.target.closest('.autocomplete-container')) {
                showProjectSuggestions.value = false;
                showSubscriptionSuggestions.value = false;
            }
        });

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

        const showNewSubscriptionForm = ref(true);

        const connectToPubSub = async () => {
            if (isConnecting.value) return;
            
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
                    const client_id = data.client_id;
                    
                    // Create subscription object
                    const subscription = {
                        client_id: client_id,
                        project_id: config.value.project_id,
                        subscription_id: config.value.subscription_id,
                        connected: true
                    };
                    
                    // Add to active subscriptions
                    activeSubscriptions.value.push(subscription);
                    
                    showToast('Connected', 'Successfully connected to Pub/Sub', 'fa-check-circle');
                    
                    // Try WebSocket first
                    initWebSocket(client_id, subscription);
                    
                    // Also start polling as a fallback
                    startMessagePolling(client_id, subscription);
                    
                    // Hide the form after successful connection
                    showNewSubscriptionForm.value = false;
                    
                    // Clear the form
                    config.value = {
                        project_id: '',
                        subscription_id: ''
                    };

                    // Clear suggestions
                    showProjectSuggestions.value = false;
                    showSubscriptionSuggestions.value = false;
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

        const disconnectSubscription = async (client_id) => {
            try {
                // Close WebSocket if it exists
                if (socketInstances.value[client_id]) {
                    socketInstances.value[client_id].close();
                    delete socketInstances.value[client_id];
                }
                
                // Call the disconnect API
                const response = await fetch(`/api/disconnect/${client_id}`, {
                    method: 'DELETE'
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    // Remove from active subscriptions
                    const index = activeSubscriptions.value.findIndex(sub => sub.client_id === client_id);
                    if (index !== -1) {
                        activeSubscriptions.value.splice(index, 1);
                    }
                    
                    showToast('Disconnected', 'Successfully disconnected from Pub/Sub subscription', 'fa-times-circle');
                } else {
                    showToast('Error', data.detail || 'Failed to disconnect', 'fa-exclamation-circle');
                }
            } catch (error) {
                console.error('Error disconnecting:', error);
                showToast('Error', 'Network error while disconnecting', 'fa-exclamation-circle');
            }
        };

        const initWebSocket = (client_id, subscription) => {
            if (socketInstances.value[client_id]) {
                console.log(`Closing existing WebSocket connection for ${client_id}`);
                socketInstances.value[client_id].close();
            }
            
            const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
            const wsUrl = `${wsProtocol}://${window.location.host}/api/ws/${client_id}`;
            console.log(`Connecting to WebSocket URL: ${wsUrl}`);
            
            const socket = new WebSocket(wsUrl);
            
            socket.onopen = () => {
                console.log(`WebSocket connected successfully for ${client_id}`);
                connectionError.value = ''; // Clear any previous error
                
                // Update subscription status
                const index = activeSubscriptions.value.findIndex(sub => sub.client_id === client_id);
                if (index !== -1) {
                    activeSubscriptions.value[index].connected = true;
                }
                
                showToast('WebSocket Connected', 'Successfully established WebSocket connection', 'fa-check-circle');
                
                // WebSocket is working, we can stop the polling fallback
                stopMessagePolling(client_id);
            };
            
            socket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    
                    if (data.type === 'message') {
                        console.log(`Received Pub/Sub message for ${client_id}:`, data.data);
                        if (!pauseMessages.value) {
                            addMessage(data.data, subscription);
                        } else {
                            console.log('Message paused, not displaying');
                        }
                    } else if (data.type === 'status') {
                        console.log(`Received status update for ${client_id}:`, data.data);
                        
                        // Update subscription status based on received status
                        const index = activeSubscriptions.value.findIndex(sub => sub.client_id === client_id);
                        
                        if (data.data.error) {
                            console.error(`Status contains error for ${client_id}:`, data.data.error);
                            if (index !== -1) {
                                activeSubscriptions.value[index].connected = false;
                                activeSubscriptions.value[index].error = data.data.error;
                            }
                            showToast('Connection Error', data.data.error, 'fa-exclamation-circle');
                        } else if (data.data.status === 'connected') {
                            console.log(`Status confirms connection for ${client_id}`);
                            if (index !== -1) {
                                activeSubscriptions.value[index].connected = true;
                                delete activeSubscriptions.value[index].error;
                            }
                        }
                    }
                } catch (error) {
                    console.error(`Error processing WebSocket message for ${client_id}:`, error, event.data);
                }
            };
            
            socket.onclose = (event) => {
                console.log(`WebSocket disconnected for ${client_id}:`, event.code, event.reason);
                
                // Update subscription status
                const index = activeSubscriptions.value.findIndex(sub => sub.client_id === client_id);
                if (index !== -1) {
                    activeSubscriptions.value[index].connected = false;
                }
                
                // Only show notification if it was not a clean disconnect (e.g. user-initiated)
                if (event.code !== 1000) {
                    showToast('Disconnected', `Connection to Pub/Sub was closed: ${event.reason || 'Unknown reason'}`, 'fa-times-circle');
                    // Try to reconnect after a brief delay
                    setTimeout(() => retryConnection(client_id, subscription), 3000);
                }
            };
            
            socket.onerror = (error) => {
                console.error(`WebSocket error for ${client_id}:`, error);
                
                // Update subscription status
                const index = activeSubscriptions.value.findIndex(sub => sub.client_id === client_id);
                if (index !== -1) {
                    activeSubscriptions.value[index].error = 'WebSocket connection error';
                }
                
                // We don't set connected to false here as onclose will be called anyway
                showToast('WebSocket Error', 'Error in WebSocket connection, will retry automatically', 'fa-exclamation-circle');
            };
            
            socketInstances.value[client_id] = socket;
        };
        
        const retryConnection = (client_id, subscription) => {
            console.log(`Attempting to reconnect WebSocket for ${client_id}...`);
            
            const index = activeSubscriptions.value.findIndex(sub => sub.client_id === client_id);
            if (index !== -1 && !activeSubscriptions.value[index].connected) {
                initWebSocket(client_id, subscription);
                // Also poll for messages as a fallback
                startMessagePolling(client_id, subscription);
            }
        };

        // Map of client_id to polling interval
        const pollingIntervals = {};
        
        // Fallback polling for messages if WebSocket fails
        const startMessagePolling = async (client_id, subscription) => {
            if (pollingIntervals[client_id]) clearInterval(pollingIntervals[client_id]);
            
            console.log(`Starting fallback message polling for ${client_id}`);
            
            // Poll every 2 seconds
            pollingIntervals[client_id] = setInterval(async () => {
                try {
                    const response = await fetch(`/api/messages/${client_id}`);
                    const data = await response.json();
                    
                    // Process messages if available
                    if (data.messages && data.messages.length > 0) {
                        console.log(`Received ${data.messages.length} messages via polling for ${client_id}`);
                        
                        // Only display if not paused
                        if (!pauseMessages.value) {
                            data.messages.forEach(message => {
                                // Check if we already have this message by ID
                                const messageId = message.message_id;
                                const exists = messages.value.some(m => 
                                    m.data && m.data.message_id === messageId
                                );
                                
                                if (!exists) {
                                    addMessage(message, subscription);
                                }
                            });
                        }
                    }
                } catch (error) {
                    console.error(`Error polling messages for ${client_id}:`, error);
                }
            }, 2000);
        };

        const stopMessagePolling = (client_id) => {
            if (pollingIntervals[client_id]) {
                console.log(`Stopping fallback message polling for ${client_id}`);
                clearInterval(pollingIntervals[client_id]);
                delete pollingIntervals[client_id];
            }
        };

        const addMessage = (message, subscription = null) => {
            // Add message to front of the array (newest first)
            messages.value.unshift({
                data: message,
                timestamp: new Date().toISOString(),
                subscription: subscription // Add the subscription information
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
                    // Check message data
                    const jsonStr = JSON.stringify(msg.data).toLowerCase();
                    
                    // Also check subscription info if available
                    if (msg.subscription) {
                        const subStr = JSON.stringify({
                            project_id: msg.subscription.project_id,
                            subscription_id: msg.subscription.subscription_id
                        }).toLowerCase();
                        
                        return jsonStr.includes(filter) || subStr.includes(filter);
                    }
                    
                    return jsonStr.includes(filter);
                } catch (e) {
                    return false;
                }
            });
        });
        
        // Add subscription filter feature
        const selectedSubscription = ref(null);
        
        // Filtered messages by both text filter and subscription filter
        const finalFilteredMessages = computed(() => {
            // First apply text filter
            let filtered = filteredMessages.value;
            
            // Then apply subscription filter if active
            if (selectedSubscription.value) {
                filtered = filtered.filter(msg => 
                    msg.subscription && 
                    msg.subscription.client_id === selectedSubscription.value.client_id
                );
            }
            
            return filtered;
        });

        // Navigate between messages
        const navigateMessage = (direction) => {
            const filtered = finalFilteredMessages.value;
            if (filtered.length === 0) return;
            
            // Find the currently expanded message index in the filtered list
            let currentExpandedIndex = -1;
            for (let i = 0; i < filtered.length; i++) {
                if (isMessageExpanded(i)) {
                    currentExpandedIndex = i;
                    break;
                }
            }
            
            // Calculate the new index
            let newIndex;
            if (currentExpandedIndex === -1) {
                // If no message is expanded, start with the first or last
                newIndex = direction > 0 ? 0 : filtered.length - 1;
            } else {
                newIndex = currentExpandedIndex + direction;
                // Handle wrapping around the ends
                if (newIndex < 0) newIndex = filtered.length - 1;
                if (newIndex >= filtered.length) newIndex = 0;
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
            finalFilteredMessages,
            activeSubscriptions,
            showNewSubscriptionForm,
            selectedSubscription,
            
            // Autocomplete state
            projects,
            subscriptions,
            filteredProjects,
            filteredSubscriptions,
            showProjectSuggestions,
            showSubscriptionSuggestions,
            loadingProjects,
            loadingSubscriptions,
            
            // Existing methods
            connectToPubSub,
            disconnectSubscription,
            clearMessages,
            toggleMessageExpanded,
            isMessageExpanded,
            getMessageType,
            formatTimestamp,
            copyMessageToClipboard,
            toggleSidebar,
            showToast,
            hideToast,
            navigateMessage,
            toggleDarkMode,
            
            // Autocomplete methods
            fetchProjects,
            fetchSubscriptions,
            projectInputChanged,
            subscriptionInputChanged,
            selectProject,
            selectSubscription,
            
            // Keyboard navigation
            selectedProjectIndex,
            selectedSubscriptionIndex,
            handleProjectKeydown,
            handleSubscriptionKeydown
        };
    }
}).mount('#app'); 