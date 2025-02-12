const API_URL = 'http://localhost:8000';
 
// DOM Elements
const fileInput = document.getElementById('file-input');
const selectedFile = document.getElementById('selected-file');
const startDetection = document.getElementById('start-detection');
const videoPreview = document.getElementById('video-preview');
const previewPlayer = document.getElementById('preview-player');
const previewCanvas = document.getElementById('preview-canvas');
const canvasContext = previewCanvas.getContext('2d');
const resultsSection = document.getElementById('results-section');
const downloadResults = document.getElementById('download-results');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
 
// Event Listeners
fileInput.addEventListener('change', handleFileSelect);
startDetection.addEventListener('click', startDetectionProcess);
downloadResults.addEventListener('click', downloadProcessedFiles);
window.addEventListener('resize', handleCanvasResize);
 
// WebSocket connection and reconnection logic
let ws = null;
let isProcessing = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 1000;
 
function initializeWebSocket() {
    if (ws) {
        ws.close();
    }
 
    try {
        ws = new WebSocket('ws://localhost:8000/ws');
       
        ws.onopen = () => {
            console.log('WebSocket connection established');
            reconnectAttempts = 0;
        };
       
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
               
                if (data.type === 'progress') {
                    updateProgress(data.data);
                } else if (data.type === 'frame') {
                    updatePreviewFrame(data.data);
                } else if (data.type === 'complete') {
                    processingComplete(data.data);
                }
            } catch (error) {
                console.error('Error processing message:', error);
            }
        };
 
        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            handleWebSocketError();
        };
 
        ws.onclose = (event) => {
            console.log('WebSocket connection closed', event.code, event.reason);
            handleWebSocketClose();
        };
    } catch (error) {
        console.error('Error creating WebSocket:', error);
        handleWebSocketError();
    }
}
 
function handleWebSocketError() {
    if (isProcessing && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        setTimeout(() => {
            console.log(`Attempting to reconnect (${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);
            reconnectAttempts++;
            initializeWebSocket();
        }, RECONNECT_DELAY);
    } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        alert('Connection failed. Please try again later.');
        resetUI();
    }
}
 
function handleWebSocketClose() {
    if (isProcessing && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        setTimeout(() => {
            console.log(`Attempting to reconnect (${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);
            reconnectAttempts++;
            initializeWebSocket();
        }, RECONNECT_DELAY);
    }
}
 
function resetUI() {
    isProcessing = false;
    startDetection.disabled = false;
    progressContainer.classList.add('hidden');
    reconnectAttempts = 0;
}
 
// File Handling Functions
function handleFileSelect(event) {
    const file = event.target.files[0];
    if (file) {
        validateAndPreviewFile(file);
    }
}
 
function validateAndPreviewFile(file) {
    if (!file.type.startsWith('video/')) {
        alert('Please upload a valid video file.');
        return;
    }
 
    selectedFile.textContent = file.name;
    startDetection.disabled = false;
   
    videoPreview.classList.remove('hidden');
   
    const video = document.createElement('video');
    video.onloadedmetadata = () => {
        previewCanvas.width = video.videoWidth;
        previewCanvas.height = video.videoHeight;
        handleCanvasResize();
        canvasContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    };
    video.src = URL.createObjectURL(file);
}
 
function handleCanvasResize() {
    if (previewCanvas.width > 0 && previewCanvas.height > 0) {
        const container = previewCanvas.parentElement;
        const aspectRatio = previewCanvas.height / previewCanvas.width;
        const newWidth = container.clientWidth;
        const newHeight = newWidth * aspectRatio;
       
        previewCanvas.style.width = `${newWidth}px`;
        previewCanvas.style.height = `${newHeight}px`;
    }
}
 
// Detection Process Functions
async function startDetectionProcess() {
    const file = fileInput.files[0];
    if (!file) return;
 
    startDetection.disabled = true;
    progressContainer.classList.remove('hidden');
    resultsSection.classList.add('hidden');
    canvasContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
   
    isProcessing = true;
    initializeWebSocket();
 
    const formData = new FormData();
    formData.append('video', file);
 
    try {
        const response = await fetch(`${API_URL}/upload`, {
            method: 'POST',
            body: formData
        });
 
        if (!response.ok) {
            throw new Error('Upload failed');
        }
 
        const data = await response.json();
        if (data.status === 'success') {
            updateProgress(0);
        } else {
            throw new Error(data.message || 'Upload failed');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Upload failed. Please try again.');
        resetUI();
    }
}
 
function updateProgress(percent) {
    progressBar.style.width = `${percent}%`;
    progressText.textContent = `Processing: ${percent}%`;
}
 
function updatePreviewFrame(frameData) {
    if (previewPlayer) {
        previewPlayer.classList.add('hidden');
    }
 
    const img = new Image();
    img.onload = () => {
        canvasContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        canvasContext.drawImage(img, 0, 0, previewCanvas.width, previewCanvas.height);
    };
    img.src = `data:image/jpeg;base64,${frameData}`;
}
 
function processingComplete(downloadUrl) {
    isProcessing = false;
    progressText.textContent = 'Processing complete!';
    resultsSection.classList.remove('hidden');
    downloadResults.dataset.url = downloadUrl;
    startDetection.disabled = false;
   
    if (previewPlayer) {
        previewPlayer.classList.add('hidden');
    }
   
    if (ws) {
        ws.close();
        ws = null;
    }
}
 
async function downloadProcessedFiles() {
    const downloadUrl = downloadResults.dataset.url;
    try {
        const response = await fetch(`${API_URL}${downloadUrl}`);
        if (!response.ok) throw new Error('Download failed');
       
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'detection_results.zip';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    } catch (error) {
        console.error('Error:', error);
        alert('Download failed. Please try again.');
    }
}
 
// Initial canvas resize
handleCanvasResize();