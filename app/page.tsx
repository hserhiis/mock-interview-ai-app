'use client';
import { useState, useEffect, useRef } from 'react';

interface IWindow extends Window {
  webkitSpeechRecognition: any;
  SpeechRecognition: any;
}

export default function Home() {
  const [step, setStep] = useState<'setup' | 'interview' | 'result'>('setup');
  const [vacancy, setVacancy] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [isWaitingForAi, setIsWaitingForAi] = useState(false);


  const lang = 'en-US';

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const accumulatedTextRef = useRef<string>("");

  const getWindow = () => typeof window !== 'undefined' ? (window as unknown as IWindow) : null;

  // Инициализация распознавания голоса
  useEffect(() => {
    const _window = getWindow();
    if (_window && (_window.webkitSpeechRecognition || _window.SpeechRecognition)) {
      const SpeechRecognition = _window.webkitSpeechRecognition || _window.SpeechRecognition;
      const recognition = new SpeechRecognition();

      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        if (!isRecording || isAiSpeaking || isWaitingForAi) {
          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
          accumulatedTextRef.current = "";
          return;
        }

        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        if (interimTranscript) {
          // Добавляем новый кусок к тому, что уже услышали
          accumulatedTextRef.current += " " + interimTranscript;
          console.log("Listening... Current progress:", accumulatedTextRef.current);

          // Сбрасываем предыдущий таймер, если ты снова начал говорить
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
          }

          // Ставим ожидание на 5000мс (5 секунд)
          silenceTimerRef.current = setTimeout(() => {
            const finalSentence = accumulatedTextRef.current.trim();
            if (finalSentence && !isAiSpeaking && !isWaitingForAi) {
              console.log("5 seconds of silence. Sending to Andrew:", finalSentence);
              handleUserResponse(finalSentence);
              accumulatedTextRef.current = ""; // Очищаем буфер после отправки
            }
          }, 5000);
        }
      };

      recognition.onerror = (e: any) => console.error("Recognition Error:", e);

      recognition.onend = () => {
        if (step === 'interview') {
          try { recognition.start(); } catch (e) {}
        }
      };

      recognitionRef.current = recognition;
    }
  }, [isRecording, step]);

  useEffect(() => {
    if (step === 'interview') {
      navigator.mediaDevices.getUserMedia({ video: true }).then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      });
      try { recognitionRef.current?.start(); } catch(e) {}
    } else {
      stopCamera();
      recognitionRef.current?.stop();
    }
  }, [step]);

  const handleUserResponse = async (userText: string) => {
    if (!userText.trim() || isAiSpeaking || isWaitingForAi) return;

    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    accumulatedTextRef.current = "";

    setIsWaitingForAi(true);
    const newMessages = [...messages, { role: 'user', content: userText }];
    setMessages(newMessages);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages, vacancy }),
      });

      const data = await response.json();

      if (data.error) {
        console.error("Server side error:", data.error);
        return;
      }

      setMessages(prev => [...prev, { role: 'assistant', content: data.text }]);

      // ПРОВЕРКА: Если аудио пришло - играем, если нет - пишем в консоль
      if (data.audio) {
        playAiAudio(data.audio);
      } else {
        console.warn("AI generated text, but NO AUDIO was returned from API.");
      }

    } catch (error) {
      console.error("Network or API Error:", error);
    } finally {
      setIsWaitingForAi(false);
    }
  };

  const playAiAudio = (audioBase64: string) => {
    // Двойная проверка на пустоту
    setIsAiSpeaking(true);

    if (!audioBase64 || audioBase64 === "data:audio/mp3;base64,null") {
      console.error("Invalid audio data string");
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }

    const audio = new Audio(audioBase64);
    audioRef.current = audio;

    audio.onplay = () => setIsAiSpeaking(true);
    audio.onended = () => {
      setIsAiSpeaking(false);
      // Очищаем буфер микрофона, чтобы он не "дослышал" остатки хвоста речи ИИ
      accumulatedTextRef.current = "";
    };

    audio.onerror = (e: any) => {
      const target = e.target as HTMLAudioElement;
      console.error("Audio playback error details:", target.error?.code, target.error?.message);
      setIsAiSpeaking(false);
    };

    audio.play().catch(err => {
      console.error("Playback start failed:", err);
      setIsAiSpeaking(false);
    });
  };

  const startInterview = async () => {
    new Audio().play().catch(() => {});
    setStep('interview');
    setIsRecording(true);
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [], vacancy }),
      });
      const data = await response.json();
      setMessages([{ role: 'assistant', content: data.text }]);
      if (data.audio) playAiAudio(data.audio);
    } catch (e) {
      console.error(e);
    }
  };

  const toggleRecording = () => setIsRecording(!isRecording);
  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  };
  const endInterview = () => { stopCamera(); setStep('result'); };

  return (
      <div className="min-h-screen bg-[#1a1a1a] text-white font-sans flex flex-col">
        {step === 'setup' && (
            <div className="flex-1 flex flex-col items-center justify-center p-4">
              <div className="bg-[#242424] p-8 rounded-2xl shadow-2xl w-full max-w-md border border-gray-700">
                <h1 className="text-2xl font-bold mb-6 text-center text-blue-500 underline decoration-2 underline-offset-8">AI Zoom Interview</h1>
                <label className="block text-sm text-gray-400 mb-2 font-medium">Target Job Role</label>
                <textarea
                    className="w-full bg-[#323232] border border-gray-600 rounded-lg p-3 focus:outline-none focus:border-blue-500 transition mb-6 text-white"
                    rows={4}
                    placeholder="e.g. Senior Frontend Engineer (React/Next.js)..."
                    value={vacancy}
                    onChange={(e) => setVacancy(e.target.value)}
                />
                <button
                    onClick={startInterview}
                    className="w-full bg-[#0E71EB] hover:bg-[#1261c4] py-3 rounded-xl font-bold transition shadow-lg active:scale-95"
                >
                  Start English Interview
                </button>
              </div>
            </div>
        )}

        {step === 'interview' && (
            <>
              <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 p-4 max-w-6xl mx-auto w-full">
                <div className="relative bg-[#242424] rounded-xl overflow-hidden border border-gray-700 aspect-video shadow-2xl">
                  <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover scale-x-[-1]" />
                  {!isRecording && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center backdrop-blur-[2px]">
                        <span className="bg-red-600 px-4 py-1 rounded-full text-xs font-bold uppercase tracking-widest animate-pulse">Mic Muted</span>
                      </div>
                  )}
                </div>

                <div className="relative bg-[#242424] rounded-xl overflow-hidden border border-gray-700 aspect-video flex items-center justify-center shadow-2xl">
                  <div className={`w-24 h-24 rounded-full flex items-center justify-center text-3xl font-black transition-all duration-500 shadow-2xl ${
                      isAiSpeaking
                          ? 'bg-blue-600 scale-110 shadow-[0_0_50px_rgba(37,99,235,0.6)] ring-4 ring-blue-400/30'
                          : 'bg-gradient-to-br from-blue-500 to-indigo-700'
                  }`}>
                    AI
                  </div>

                  <div className={`
                      bg-black/80 backdrop-blur-xl border border-white/10 
                      rounded-2xl p-3 md:p-4 
                      shadow-2xl transition-all duration-300
                      max-w-[95%] w-fit
                      ${isAiSpeaking ? 'scale-100 opacity-100' : 'scale-95 opacity-90'}
                      pointer-events-auto
                    `}>
                    <p className="text-sm md:text-base lg:text-lg font-medium text-white text-center leading-relaxed break-words overflow-y-auto max-h-[120px] md:max-h-[160px] custom-scrollbar">
                      {isWaitingForAi ? (
                          <span className="flex items-center gap-2 italic text-gray-400">
                            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></span>
                            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0.4s]"></span>
                          </span>
                      ) : (
                          messages.findLast(m => m.role === 'assistant')?.content || "Connecting..."
                      )}
                    </p>
                  </div>
                </div>
              </div>

              <div className="h-24 bg-[#1a1a1a] border-t border-gray-800 flex items-center justify-center gap-8 px-4">
                <button
                    onClick={toggleRecording}
                    className={`flex flex-col items-center gap-1.5 transition-all ${isRecording ? 'text-blue-400' : 'text-red-500'}`}
                >
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${isRecording ? 'bg-blue-500/20' : 'bg-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.4)]'}`}>
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                      {isRecording ? (
                          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                      ) : (
                          <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17l1.42 1.42C16.13 11.97 16 11.48 16 11V5c0-2.21-1.79-4-4-4S8 2.79 8 5v.28l8.98 8.98V11c0 .06-.01.11-.02.17zM2 5.27L3.27 4l18.46 18.46L20.46 23l-6.1-6.1C13.48 16.68 12.77 17 12 17c-3.53 0-6-2.47-6-6h2c0 2.21 1.79 4 4 4 .41 0 .8-.07 1.18-.19l-2.42-2.42C10.28 12.31 10 11.7 10 11V8.27L2 5.27z" />
                      )}
                    </svg>
                  </div>
                  <span className="text-[10px] uppercase font-black tracking-tighter">{isRecording ? 'Unmuted' : 'Muted'}</span>
                </button>

                <button onClick={endInterview} className="flex flex-col items-center gap-1.5 group">
                  <div className="w-20 h-10 bg-[#E02828] rounded-lg flex items-center justify-center text-white group-hover:bg-[#ff3b3b] transition-colors font-bold text-sm shadow-lg">
                    End
                  </div>
                  <span className="text-[10px] uppercase font-black tracking-tighter text-red-500">Leave</span>
                </button>
              </div>
            </>
        )}

        {step === 'result' && (
            <div className="flex-1 flex flex-col items-center justify-center p-4 animate-in fade-in zoom-in duration-300 text-center">
              <div className="bg-[#242424] p-10 rounded-3xl shadow-2xl w-full max-w-2xl border border-blue-900/30">
                <div className="w-20 h-20 bg-blue-600/20 rounded-full flex items-center justify-center mx-auto mb-6 text-blue-500">
                  <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h2 className="text-3xl font-bold mb-4">Interview Complete!</h2>
                <p className="text-gray-400 mb-8 text-lg">
                  Great job. Andrew is impressed. Ready for a detailed analysis of your performance and personal recommendations?
                </p>

                <div className="grid md:grid-cols-2 gap-4 mb-8">
                  <div className="bg-[#323232] p-6 rounded-2xl border border-gray-700">
                    <h3 className="text-xl font-bold mb-2">$19 / session</h3>
                    <p className="text-sm text-gray-400">One-time deep dive analysis by AI Coach</p>
                  </div>
                  <div className="bg-blue-600/10 p-6 rounded-2xl border border-blue-500/50">
                    <h3 className="text-xl font-bold mb-2">$39 / mo</h3>
                    <p className="text-sm text-gray-400">Unlimited interviews & feedback reports</p>
                  </div>
                </div>

                {/* Кнопка с логикой перезагрузки */}
                <button
                    onClick={() => {
                      // Имитируем открытие Stripe (например в новой вкладке)
                      // window.open('https://buy.stripe.com/your_link', '_blank');

                      // Чтобы приложение перезагрузилось, когда пользователь закроет окно оплаты и вернется
                      alert("Redirecting to Checkout... \n(The app will restart after you close the payment window)");

                      // Перезагрузка страницы
                      window.location.reload();
                    }}
                    className="w-full bg-[#0E71EB] hover:bg-[#1261c4] py-4 rounded-xl font-bold text-lg transition mb-4 shadow-lg active:scale-[0.98]"
                >
                  Get Full Report (via Stripe)
                </button>

                <button
                    onClick={() => window.location.reload()}
                    className="text-gray-500 hover:text-white transition text-sm underline"
                >
                  Back to Setup
                </button>
              </div>
            </div>
        )}
      </div>
  );
}