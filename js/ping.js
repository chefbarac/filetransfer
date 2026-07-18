let audioCtx;

async function playPing() {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }

        if (audioCtx.state === "suspended") {
            await audioCtx.resume();
        }

        const notes = [
            { freq: 880, duration: 0.18 },
            { freq: 1175, duration: 0.18 },
            { freq: 1568, duration: 0.35 },
        ];

        let start = audioCtx.currentTime;

        notes.forEach(({ freq, duration }) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();

            osc.type = "triangle";
            osc.frequency.value = freq;

            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

            osc.connect(gain);
            gain.connect(audioCtx.destination);

            osc.start(start);
            osc.stop(start + duration);

            start += duration * 0.85;
        });
    } catch (err) {
        console.error(err);
    }
}