// Main Application Logic
class P2PChatApp {
    constructor() {
        this.roomId = null;
        this.userId = this.generateUserId();
        this.nickname = null;
        this.webrtcHandler = null;
        this.firebaseHandler = window.firebaseHandler;
        this.messageHandler = new MessageHandler();
        this.fileHandler = window.fileHandler;
        this.callHandler = null; // Will be initialized after joining room
        this.peers = new Set();
        this.peerNicknames = new Map(); // Map of peerId -> nickname
        this.connectionState = CONFIG.CONNECTION_STATE.DISCONNECTED;
        this.savedRoomId = null; // Store for reconnection
        this.savedNickname = null; // Store for reconnection
        
        this.init();
    }

    // Initialize the application
    init() {
        this.setupEventListeners();
        this.setupMessageHandlers();
        
        // Initialize Firebase when ready
        if (this.firebaseHandler) {
            this.firebaseHandler.initialize().catch(err => {
                console.warn('Firebase initialization failed:', err);
                this.updateConnectionStatus(CONFIG.CONNECTION_STATE.DISCONNECTED);
            });
        }
    }

    // Generate unique user ID
    generateUserId() {
        return 'user-' + Math.random().toString(36).substr(2, 9);
    }

    // Setup UI event listeners
    setupEventListeners() {
        // Join room button
        const joinBtn = document.getElementById('joinBtn');
        const roomInput = document.getElementById('roomInput');
        const nicknameInput = document.getElementById('nicknameInput');
        
        // Load saved nickname from localStorage
        const savedNickname = localStorage.getItem('chatNickname');
        if (savedNickname) {
            nicknameInput.value = savedNickname;
        }
        
        joinBtn.addEventListener('click', () => this.joinRoom());
        roomInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                // Move to nickname input if room ID is filled
                if (roomInput.value.trim()) {
                    nicknameInput.focus();
                }
            }
        });
        nicknameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.joinRoom();
            }
        });

        // Message input
        const messageInput = document.getElementById('messageInput');
        const sendButton = document.getElementById('sendButton');
        
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        sendButton.addEventListener('click', () => this.sendMessage());
        
        // File sharing
        const fileButton = document.getElementById('fileButton');
        const fileInput = document.getElementById('fileInput');
        
        fileButton.addEventListener('click', () => {
            // Notify WebRTC handler that file selection is starting
            if (this.webrtcHandler) {
                this.webrtcHandler.setFileSelectionActive(true);
                console.log('[App] File selection started, extended disconnect timeout active');
            }
            fileInput.click();
        });
        
        fileInput.addEventListener('change', (e) => {
            // File selection completed
            if (this.webrtcHandler) {
                this.webrtcHandler.setFileSelectionActive(false);
                console.log('[App] File selection completed');
            }
            this.handleFileSelect(e.target.files);
            fileInput.value = ''; // Reset input
        });
        
        // Also handle if user cancels file selection
        fileInput.addEventListener('cancel', () => {
            if (this.webrtcHandler) {
                this.webrtcHandler.setFileSelectionActive(false);
                console.log('[App] File selection cancelled');
            }
        });
        
        // Handle focus events to detect when file dialog is closed
        window.addEventListener('focus', () => {
            // Small delay to ensure file input change event fires first if a file was selected
            setTimeout(() => {
                if (this.webrtcHandler && this.webrtcHandler.fileSelectionActive) {
                    this.webrtcHandler.setFileSelectionActive(false);
                    console.log('[App] File dialog closed (window refocused)');
                }
            }, 100);
        });

        // Reconnect button
        const reconnectBtn = document.getElementById('reconnectBtn');
        if (reconnectBtn) {
            reconnectBtn.addEventListener('click', () => {
                this.reconnect();
            });
        }
        
        // Typing indicator
        let typingTimer;
        messageInput.addEventListener('input', () => {
            if (this.roomId) {
                // Send typing indicator via WebRTC if connected, otherwise Firebase
                const typingMessage = {
                    type: 'typing',
                    userId: this.userId,
                    nickname: this.nickname,
                    isTyping: true,
                    timestamp: Date.now()
                };
                
                if (this.webrtcHandler && this.webrtcHandler.isConnected()) {
                    this.webrtcHandler.sendMessage(typingMessage);
                } else if (this.firebaseHandler) {
                    this.firebaseHandler.sendTypingIndicator(true);
                }
                
                clearTimeout(typingTimer);
                typingTimer = setTimeout(() => {
                    const stopTypingMessage = {
                        type: 'typing',
                        userId: this.userId,
                        nickname: this.nickname,
                        isTyping: false,
                        timestamp: Date.now()
                    };
                    
                    if (this.webrtcHandler && this.webrtcHandler.isConnected()) {
                        this.webrtcHandler.sendMessage(stopTypingMessage);
                    } else if (this.firebaseHandler) {
                        this.firebaseHandler.sendTypingIndicator(false);
                    }
                }, CONFIG.TYPING_TIMEOUT);
            }
        });
    }

    // Setup message handlers
    setupMessageHandlers() {
        // Handle received messages
        this.messageHandler.onMessage((message, source) => {
            this.messageHandler.displayMessage(message, false);
        });
    }

    // Join a room
    async joinRoom() {
        const roomInput = document.getElementById('roomInput');
        const nicknameInput = document.getElementById('nicknameInput');
        const roomId = roomInput.value.trim().toUpperCase();
        const nickname = nicknameInput.value.trim() || 'Anonymous';
        
        if (!roomId || roomId.length < 4) {
            alert('Please enter a valid room ID (at least 4 characters)');
            return;
        }

        this.roomId = roomId;
        this.nickname = nickname;
        
        // Save for potential reconnection
        this.savedRoomId = roomId;
        this.savedNickname = nickname;
        
        // Save nickname to localStorage
        localStorage.setItem('chatNickname', nickname);
        
        // Hide modal, show chat
        document.getElementById('roomModal').style.display = 'none';
        document.getElementById('chatApp').style.display = 'flex';
        
        // Update room display (show as private for security)
        document.getElementById('roomDisplay').textContent = 'Private Room';
        
        // Enable input and file button
        document.getElementById('messageInput').disabled = false;
        document.getElementById('sendButton').disabled = false;
        document.getElementById('fileButton').disabled = false;
        
        // Initialize WebRTC
        this.webrtcHandler = new WebRTCHandler(roomId, this.userId);
        this.setupWebRTCHandlers();
        
        // Initialize Call Handler
        this.callHandler = new CallHandler(this.webrtcHandler, this.userId, this.nickname);
        this.callHandler.initializeUI();
        
        // Setup file handler
        this.setupFileHandlers();
        
        // Join Firebase room with nickname
        if (this.firebaseHandler) {
            await this.firebaseHandler.joinRoom(roomId, this.userId, this.nickname);
            this.setupFirebaseHandlers();
        }
        
        // Display system message with loading indicator
        this.messageHandler.displaySystemMessage(`Joined private room`);
        this.messageHandler.displaySystemMessage(`⏳ Waiting for P2P connection to be established...`);
        
        // Update connection status
        this.updateConnectionStatus(CONFIG.CONNECTION_STATE.CONNECTING);
    }

    // Setup WebRTC handlers
    setupWebRTCHandlers() {
        // Handle WebRTC messages
        this.webrtcHandler.onMessage((message, peerId) => {
            // Check if it's a call or media message
            if (message.type && (message.type.startsWith('call-') || message.type.startsWith('media-'))) {
                if (this.callHandler) {
                    this.callHandler.handleMessage(message);
                }
            } else if (message.type === 'typing') {
                console.log('Received typing message:', message);
                // Don't show typing indicator for own messages
                if (message.userId !== this.userId) {
                    this.messageHandler.handleTyping(message.userId, message.nickname, message.isTyping);
                }
            } else if (message.type === 'file-metadata') {
                this.fileHandler.handleFileMetadata(message.metadata);
            } else if (message.type === 'file-chunk') {
                this.fileHandler.handleFileChunk(message.fileId, message.chunkIndex, message.data);
            } else if (message.type === 'file-complete') {
                this.fileHandler.handleFileComplete(message.fileId);
            } else if (this.messageHandler.receiveMessage(message, 'webrtc')) {
                // Regular message was new (not duplicate)
                this.updateConnectionStatus(CONFIG.CONNECTION_STATE.CONNECTED);
            }
        });

        // Handle peer connected
        this.webrtcHandler.onPeerConnected((peerId) => {
            // Don't add to peers here - already added in onPeerJoined
            this.updatePeerCount();
            const nickname = this.peerNicknames.get(peerId) || 'Peer';
            this.messageHandler.displaySystemMessage(`✅ P2P connection established with ${nickname}`);
            this.updateConnectionStatus(CONFIG.CONNECTION_STATE.CONNECTED);
            
            // Enable file button and call buttons when P2P is connected
            document.getElementById('fileButton').disabled = false;
            if (this.callHandler) {
                this.callHandler.enableCallButtons();
            }
        });

        // Handle peer disconnected
        this.webrtcHandler.onPeerDisconnected((peerId) => {
            // Don't show any message here - it will be shown in onPeerLeft
            // Update connection status based on remaining connections
            const connectedCount = this.webrtcHandler.getConnectedPeersCount();
            if (connectedCount === 0 && this.peers.size > 0) {
                // We have peers but no WebRTC connections - connecting state
                this.updateConnectionStatus(CONFIG.CONNECTION_STATE.CONNECTING);
            } else if (connectedCount === 0 && this.peers.size === 0) {
                // No peers at all - disconnected state  
                this.updateConnectionStatus(CONFIG.CONNECTION_STATE.DISCONNECTED);
            }
        });
    }

    // Setup Firebase handlers
    setupFirebaseHandlers() {
        // Handle Firebase messages
        this.firebaseHandler.onMessage((message, senderId) => {
            if (this.messageHandler.receiveMessage(message, 'firebase')) {
                // Message was new (not duplicate)
            }
        });

        // Handle peer joined
        this.firebaseHandler.onPeerJoined(async (peerId, nickname, isExistingUser = false) => {
            console.log(`[App] Peer joined: ${peerId} (${nickname}), existing: ${isExistingUser}`);
            // Check if peer already exists to avoid duplicates
            const isNewPeer = !this.peers.has(peerId);
            
            // If peer exists but reconnecting, clean up old connection first
            if (!isNewPeer && this.webrtcHandler) {
                console.log(`[App] Cleaning up old connection for ${peerId}`);
                // Clean up any existing connection
                this.webrtcHandler.handlePeerDisconnected(peerId);
            }
            
            // Add peer to set
            this.peers.add(peerId);
            this.peerNicknames.set(peerId, nickname);
            
            // Show system message only for truly new joins (not existing users)
            if (!isExistingUser) {
                if (isNewPeer) {
                    this.messageHandler.displaySystemMessage(`${nickname} joined the room`);
                } else {
                    this.messageHandler.displaySystemMessage(`${nickname} reconnected`);
                }
            }
            
            // Check if we should initiate WebRTC connection
            const users = await this.firebaseHandler.getRoomUsers();
            console.log(`[App] Room has ${users.length} users`);
            
            if (users.length <= CONFIG.MAX_PEERS) {
                // Important: Only ONE peer should initiate to avoid duplicate connections
                // Use consistent rule: peer with lexicographically SMALLER ID initiates
                const shouldInitiate = this.userId < peerId;
                
                if (shouldInitiate) {
                    console.log(`[App] Will initiate WebRTC connection to ${nickname} (${peerId})`);
                    
                    // Try to establish connection with retry logic
                    this.establishConnectionWithRetry(peerId, nickname, 3);
                } else {
                    console.log(`[App] Waiting for ${nickname} (${peerId}) to initiate connection`);
                }
            } else {
                console.warn(`[App] Room full (${users.length} users), not connecting to ${nickname}`);
            }
            this.updatePeerCount();
        });

        // Handle peer left
        this.firebaseHandler.onPeerLeft((peerId, nickname) => {
            // Only show message if peer was actually in our set
            if (this.peers.has(peerId)) {
                const peerNick = nickname || this.peerNicknames.get(peerId) || 'Peer';
                this.messageHandler.displaySystemMessage(`${peerNick} left the room`);
            }
            
            this.peers.delete(peerId);
            this.peerNicknames.delete(peerId);
            
            this.updatePeerCount();
            this.webrtcHandler.handlePeerDisconnected(peerId);
        });

        // Handle WebRTC signaling
        this.firebaseHandler.onSignal((fromPeer, signal) => {
            this.webrtcHandler.handleSignal(fromPeer, signal);
        });
    }

    // Send message
    async sendMessage() {
        const messageInput = document.getElementById('messageInput');
        const text = messageInput.value.trim();
        
        if (!text) return;
        
        // Send through dual delivery system with nickname
        const message = await this.messageHandler.sendMessage(
            text,
            this.webrtcHandler,
            this.firebaseHandler,
            this.nickname
        );
        
        if (message) {
            // Display sent message
            this.messageHandler.displayMessage(message, true);
            
            // Clear input
            messageInput.value = '';
            
            // Clear typing indicator
            clearTimeout(typingTimer);
            const stopTypingMessage = {
                type: 'typing',
                userId: this.userId,
                nickname: this.nickname,
                isTyping: false,
                timestamp: Date.now()
            };
            
            if (this.webrtcHandler && this.webrtcHandler.isConnected()) {
                this.webrtcHandler.sendMessage(stopTypingMessage);
            } else if (this.firebaseHandler) {
                this.firebaseHandler.sendTypingIndicator(false);
            }
        } else {
            alert('Failed to send message. Please check your connection.');
        }
    }

    // Reconnect to the same room
    async reconnect() {
        if (!this.savedRoomId || !this.savedNickname) {
            console.log('[App] No room data for reconnection');
            return;
        }
        
        console.log('[App] Reconnecting to room...');
        const reconnectBtn = document.getElementById('reconnectBtn');
        reconnectBtn.textContent = 'Reconnecting...';
        reconnectBtn.disabled = true;
        
        try {
            // Clean up existing connections
            if (this.webrtcHandler) {
                this.webrtcHandler.disconnect();
                this.webrtcHandler = null;
            }
            
            if (this.firebaseHandler && this.firebaseHandler.roomRef) {
                await this.firebaseHandler.leaveRoom();
            }
            
            // Clear messages
            document.getElementById('messagesArea').innerHTML = '';
            this.messageHandler.displaySystemMessage('Reconnecting to room...');
            
            // Generate new user ID for fresh connection
            this.userId = this.generateUserId();
            this.roomId = this.savedRoomId;
            this.nickname = this.savedNickname;
            
            // Reset peers tracking
            this.peers.clear();
            this.peerNicknames.clear();
            
            // Reinitialize WebRTC
            this.webrtcHandler = new WebRTCHandler(this.savedRoomId, this.userId);
            this.setupWebRTCHandlers();
            
            // Reinitialize call handler
            if (this.callHandler) {
                this.callHandler.cleanup();
            }
            this.callHandler = new CallHandler(this.webrtcHandler, this.userId, this.nickname);
            this.callHandler.initializeUI();
            
            // Setup file handler
            this.setupFileHandlers();
            
            // Rejoin Firebase room
            await this.firebaseHandler.joinRoom(this.savedRoomId, this.userId, this.savedNickname);
            this.setupFirebaseHandlers();
            
            this.messageHandler.displaySystemMessage('✅ Reconnected successfully');
            this.messageHandler.displaySystemMessage('⏳ Waiting for P2P connection to be established...');
        } catch (error) {
            console.error('[App] Reconnection failed:', error);
            this.messageHandler.displaySystemMessage('❌ Reconnection failed. Please try again.');
        } finally {
            reconnectBtn.textContent = 'Reconnect';
            reconnectBtn.disabled = false;
        }
    }

    // Update connection status indicator
    updateConnectionStatus(state) {
        this.connectionState = state;
        
        const dots = document.querySelectorAll('.status-dot');
        dots.forEach(dot => {
            dot.classList.remove('active-green', 'active-yellow', 'active-red');
        });
        
        const reconnectBtn = document.getElementById('reconnectBtn');
        const callControls = document.getElementById('callControls');
        
        switch (state) {
            case CONFIG.CONNECTION_STATE.CONNECTED:
                dots[2].classList.add('active-green');
                // Hide reconnect, show call controls if peers connected
                if (reconnectBtn) reconnectBtn.style.display = 'none';
                if (callControls && this.peers.size > 0) {
                    callControls.style.display = 'flex';
                }
                break;
            case CONFIG.CONNECTION_STATE.CONNECTING:
                dots[1].classList.add('active-yellow');
                // Hide both during connecting
                if (reconnectBtn) reconnectBtn.style.display = 'none';
                if (callControls) callControls.style.display = 'none';
                break;
            case CONFIG.CONNECTION_STATE.DISCONNECTED:
                dots[0].classList.add('active-red');
                // Show reconnect button when disconnected and we have saved room data
                if (reconnectBtn && this.savedRoomId && this.peers.size === 0) {
                    reconnectBtn.style.display = 'inline-block';
                }
                // Hide call controls when disconnected
                if (callControls) callControls.style.display = 'none';
                break;
        }
    }

    // Establish connection with retry logic
    async establishConnectionWithRetry(peerId, nickname, retries = 3) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            console.log(`[App] Connection attempt ${attempt}/${retries} to ${nickname}`);
            
            try {
                // Check if already connected
                const connectedPeers = this.webrtcHandler.getConnectedPeerIds();
                if (connectedPeers.includes(peerId)) {
                    console.log(`[App] Already connected to ${peerId}`);
                    return;
                }
                
                // Try to create connection
                await this.webrtcHandler.createPeerConnection(peerId, true);
                
                // Wait a bit to see if connection establishes
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // Check if connected
                const connectedAfter = this.webrtcHandler.getConnectedPeerIds();
                if (connectedAfter.includes(peerId)) {
                    console.log(`[App] Successfully connected to ${peerId}`);
                    return;
                }
                
                console.log(`[App] Connection attempt ${attempt} failed, will retry...`);
            } catch (error) {
                console.error(`[App] Connection attempt ${attempt} error:`, error);
            }
            
            // Wait before retry
            if (attempt < retries) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        console.error(`[App] Failed to connect to ${nickname} after ${retries} attempts`);
    }

    // Update peer count display
    async updatePeerCount() {
        let count = 0;
        
        if (this.firebaseHandler && this.firebaseHandler.roomRef) {
            const users = await this.firebaseHandler.getRoomUsers();
            count = users.length - 1; // Exclude self
        }
        
        const connectedCount = this.webrtcHandler ? this.webrtcHandler.getConnectedPeersCount() : 0;
        console.log(`[App] Updating peer count: ${connectedCount}/${count} connected`);
        
        const peerCountEl = document.getElementById('peerCount');
        peerCountEl.textContent = count === 1 ? '1 peer' : `${count} peers`;
        
        // Update connection status based on WebRTC connections
        if (this.webrtcHandler && this.webrtcHandler.isConnected()) {
            this.updateConnectionStatus(CONFIG.CONNECTION_STATE.CONNECTED);
        } else if (count > 0) {
            this.updateConnectionStatus(CONFIG.CONNECTION_STATE.CONNECTING);
        } else {
            this.updateConnectionStatus(CONFIG.CONNECTION_STATE.DISCONNECTED);
        }
    }

    // Leave room and cleanup
    leaveRoom() {
        if (this.webrtcHandler) {
            this.webrtcHandler.disconnect();
        }
        
        if (this.firebaseHandler) {
            this.firebaseHandler.leaveRoom();
        }
        
        this.messageHandler.clearMessages();
        this.peers.clear();
        
        // Reset UI
        document.getElementById('roomModal').style.display = 'flex';
        document.getElementById('chatApp').style.display = 'none';
        document.getElementById('roomInput').value = '';
        document.getElementById('messageInput').disabled = true;
        document.getElementById('sendButton').disabled = true;
        
        this.updateConnectionStatus(CONFIG.CONNECTION_STATE.DISCONNECTED);
    }

    // Setup file handlers
    setupFileHandlers() {
        if (!this.fileHandler) return;
        
        // Handle file received
        this.fileHandler.onFileReceived((file) => {
            this.displayFileMessage(file, false);
        });
        
        // Handle file progress
        this.fileHandler.onProgress((fileId, progress, direction, metadata) => {
            this.updateFileProgress(fileId, progress, direction, metadata);
        });
    }
    
    // Handle file selection
    async handleFileSelect(files) {
        if (!files || files.length === 0) return;
        
        // Check if WebRTC is connected
        if (!this.webrtcHandler || !this.webrtcHandler.isConnected()) {
            this.messageHandler.displaySystemMessage('⏳ Please wait for P2P connection to be established before sharing files');
            document.getElementById('fileInput').value = ''; // Clear file input
            return;
        }
        
        // Send each file
        for (const file of files) {
            try {
                const metadata = await this.fileHandler.sendFile(file, this.webrtcHandler, this.nickname);
                this.displayFileMessage(metadata, true);
            } catch (error) {
                console.error('Failed to send file:', error);
                alert(`Failed to send ${file.name}: ${error.message}`);
            }
        }
    }
    
    // Display file message in chat
    displayFileMessage(fileData, isSent) {
        const messagesArea = document.getElementById('messagesArea');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isSent ? 'sent' : 'received'} file-message`;
        messageDiv.dataset.fileId = fileData.id;
        
        const time = new Date(fileData.timestamp || Date.now()).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
        
        const isImage = this.fileHandler.isImage(fileData.type);
        
        messageDiv.innerHTML = `
            <div class="message-bubble file-bubble">
                ${!isSent ? `<div class="message-header">
                    <span class="message-sender">${fileData.senderNickname || 'Peer'}</span>
                </div>` : ''}
                <div class="file-content">
                    <div class="file-icon-wrapper" style="position: relative;">
                        <div class="file-icon">${isImage ? '🖼️' : '📄'}</div>
                        ${fileData.url ? 
                            `<a href="${fileData.url}" download="${fileData.name}" class="file-download-btn" title="Download ${fileData.name}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                    <polyline points="7 10 12 15 17 10"></polyline>
                                    <line x1="12" y1="15" x2="12" y2="3"></line>
                                </svg>
                            </a>` : ''
                        }
                    </div>
                    <div class="file-info">
                        <div class="file-name">${this.escapeHtml(fileData.name)}</div>
                        <div class="file-size">${this.fileHandler.formatFileSize(fileData.size)}</div>
                        ${!fileData.url ? 
                            `<div class="file-progress" id="progress-${fileData.id}">
                                <div class="progress-bar" style="width: 0%"></div>
                            </div>` : ''
                        }
                    </div>
                </div>
                <div class="message-time">${time}</div>
            </div>
        `;
        
        messagesArea.appendChild(messageDiv);
        messagesArea.scrollTop = messagesArea.scrollHeight;
    }
    
    // Update file transfer progress
    updateFileProgress(fileId, progress, direction, metadata) {
        const progressEl = document.getElementById(`progress-${fileId}`);
        if (progressEl) {
            const progressBar = progressEl.querySelector('.progress-bar');
            if (progressBar) {
                progressBar.style.width = `${Math.round(progress * 100)}%`;
            }
            
            if (progress >= 1) {
                // Transfer complete
                setTimeout(() => {
                    if (direction === 'sending') {
                        progressEl.innerHTML = '<span class="file-sent">✓ Sent</span>';
                    }
                }, 500);
            }
        }
    }
    
    // Escape HTML for display
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.chatApp = new P2PChatApp();
});