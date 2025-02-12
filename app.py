from flask import Flask, request, send_file, jsonify
from flask_cors import CORS
from flask_sock import Sock
import cv2
import numpy as np
from ultralytics import YOLO
import os
import tempfile
import csv
from datetime import datetime
import base64
import asyncio
from typing import List
import zipfile
from pathlib import Path
import threading
from queue import Queue
import json
 
app = Flask(__name__,static_folder="static")
CORS(app)
sock = Sock(app)
 
# Global variables
MODEL = YOLO("wm_model.pt")
CLASS_NAMES = ["black_bag", "brown_box", "white_bag", "white_box"]
active_connections = []
message_queue = Queue()
 
def broadcast_message(message_type, data):
    """Broadcast message to all connected websocket clients"""
    message = json.dumps({
        "type": message_type,
        "data": data
    })
    for ws in active_connections[:]:
        try:
            ws.send(message)
        except Exception:
            active_connections.remove(ws)
 
def process_video_thread(input_path, output_path, csv_path):
    cap = cv2.VideoCapture(input_path)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = int(cap.get(cv2.CAP_PROP_FPS))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
   
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))
   
    with open(csv_path, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['Frame', 'Timestamp', 'Class', 'Confidence', 'Bounding Box'])
   
    ret, prev_frame = cap.read()
    prev_gray = cv2.cvtColor(prev_frame, cv2.COLOR_BGR2GRAY)
    frame_count = 0
   
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
           
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        flow = cv2.calcOpticalFlowFarneback(prev_gray, gray, None, 0.5, 3, 15, 3, 5, 1.2, 0)
        magnitude, _ = cv2.cartToPolar(flow[..., 0], flow[..., 1])
        motion_mask = magnitude > 2
        prev_gray = gray
       
        if frame_count < 100:
            frame_count += 1
            continue
        elif frame_count < 220 and frame_count % 6 != 0:
            frame_count += 1
            continue
       
        results = MODEL(frame, conf=0.3)
       
        for r in results:
            boxes = r.boxes
            for box in boxes:
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                conf = float(box.conf[0])
                cls = int(box.cls[0])
               
                roi_motion = motion_mask[y1:y2, x1:x2]
                if np.any(roi_motion):
                    cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                    cv2.putText(frame, f"{CLASS_NAMES[cls]} {conf:.2f}",
                              (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
                   
                    with open(csv_path, 'a', newline='') as f:
                        writer = csv.writer(f)
                        writer.writerow([
                            frame_count,
                            datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                            CLASS_NAMES[cls],
                            f"{conf:.2f}",
                            f"({x1}, {y1}, {x2}, {y2})"
                        ])
       
        out.write(frame)
        _, buffer = cv2.imencode('.jpg', frame)
        frame_base64 = base64.b64encode(buffer).decode('utf-8')
       
        broadcast_message("frame", frame_base64)
       
        progress = int((frame_count / total_frames) * 100)
        broadcast_message("progress", progress)
       
        frame_count += 1
   
    cap.release()
    out.release()
   
    # Create zip file with results
    zip_path = os.path.join(tempfile.gettempdir(), "detection_results.zip")
    with zipfile.ZipFile(zip_path, 'w') as zipf:
        if os.path.exists(output_path):
            zipf.write(output_path, "processed_video.mp4")
        if os.path.exists(csv_path):
            zipf.write(csv_path, "detections.csv")
   
    # Notify clients of completion
    broadcast_message("complete", f"/download/detection_results.zip")
 
@sock.route('/ws')
def websocket(ws):
    active_connections.append(ws)
    try:
        while True:
            data = ws.receive()
    except Exception:
        if ws in active_connections:
            active_connections.remove(ws)
 
@app.route('/upload', methods=['POST'])
def upload_video():
    if 'video' not in request.files:
        return jsonify({"error": "No video file provided"}), 400
       
    video = request.files['video']
   
    # Create temporary directories for processing
    temp_dir = tempfile.mkdtemp()
    input_path = os.path.join(temp_dir, "input.mp4")
    output_path = os.path.join(temp_dir, "output.mp4")
    csv_path = os.path.join(temp_dir, "detections.csv")
   
    # Save uploaded video
    video.save(input_path)
   
    # Start processing in background thread
    processing_thread = threading.Thread(
        target=process_video_thread,
        args=(input_path, output_path, csv_path)
    )
    processing_thread.start()
   
    return jsonify({"status": "success", "message": "Processing started"})
 
@app.route('/download/<filename>')
def download_results(filename):
    temp_dir = tempfile.gettempdir()
    file_path = os.path.join(temp_dir, filename)
   
    if not os.path.exists(file_path):
        return jsonify({"error": "File not found"}), 404
   
    return send_file(
        file_path,
        mimetype="application/zip",
        as_attachment=True,
        download_name="detection_results.zip"
    )
@app.before_request
def before_first_request():
    """Create necessary temporary directories on startup"""
    os.makedirs(tempfile.gettempdir(), exist_ok=True)
 
def cleanup_temp_files():
    """Cleanup temporary files"""
    temp_dir = tempfile.gettempdir()
    for file in os.listdir(temp_dir):
        try:
            file_path = os.path.join(temp_dir, file)
            if os.path.isfile(file_path):
                os.unlink(file_path)
        except Exception as e:
            print(f"Error deleting {file}: {e}")
 
if __name__ == "__main__":
    app.run(host="localhost", port=8000, debug=True)