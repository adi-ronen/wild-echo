const recordBtn = document.getElementById('record-btn');
const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');

let audioCtx;
let analyser;
let stream;

// Function to start the audio visualization
async function startAudio() {
    try {
        // Create audio context on user interaction
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }

        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser();

        analyser.fftSize = 256;
        source.connect(analyser);

        draw();
        recordBtn.innerText = "Listening...";
        recordBtn.style.borderColor = "#e74c3c";
        recordBtn.style.color = "#e74c3c";

    } catch (err) {
        console.error("Error accessing microphone:", err);
        alert("Please allow microphone access to use Wild Echo!");
    }
}

function draw() {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const drawVisual = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const barWidth = (canvas.width / bufferLength) * 2.5;
    let barHeight;
    let x = 0;

    for(let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 2;
        ctx.fillStyle = `rgb(46, 204, 113)`;
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
    }
}

recordBtn.addEventListener('click', () => {
    startAudio();
});
