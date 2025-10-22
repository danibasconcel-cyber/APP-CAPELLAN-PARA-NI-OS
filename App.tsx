
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveSession, LiveServerMessage, Modality } from '@google/genai';
import { ConnectionState, Transcript } from './types';
import { decode, decodeAudioData, createBlob } from './utils/audio';
import ChaplainIcon from './components/ChaplainIcon';
import UserIcon from './components/UserIcon';
import StatusIndicator from './components/StatusIndicator';

const App: React.FC = () => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.IDLE);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [currentChaplainTranscription, setCurrentChaplainTranscription] = useState('');
  const [currentUserTranscription, setCurrentUserTranscription] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  // Fix: Use refs to accumulate transcription to avoid stale closures in callbacks.
  const currentChaplainTranscriptionRef = useRef('');
  const currentUserTranscriptionRef = useRef('');
  const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const transcriptContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
    }
  }, [transcripts, currentChaplainTranscription, currentUserTranscription]);

  const cleanup = useCallback(() => {
    microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
    scriptProcessorRef.current?.disconnect();
    inputAudioContextRef.current?.close();
    outputAudioContextRef.current?.close();
    
    audioSourcesRef.current.forEach(source => source.stop());
    audioSourcesRef.current.clear();

    microphoneStreamRef.current = null;
    scriptProcessorRef.current = null;
    inputAudioContextRef.current = null;
    outputAudioContextRef.current = null;
    sessionPromiseRef.current = null;
  }, []);

  const handleToggleConversation = async () => {
    if (connectionState === ConnectionState.CONNECTED) {
      if (sessionPromiseRef.current) {
        const session = await sessionPromiseRef.current;
        session.close();
      }
      cleanup();
      setConnectionState(ConnectionState.CLOSED);
      return;
    }

    setConnectionState(ConnectionState.CONNECTING);
    setTranscripts([]);
    setCurrentChaplainTranscription('');
    setCurrentUserTranscription('');
    currentUserTranscriptionRef.current = '';
    currentChaplainTranscriptionRef.current = '';

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphoneStreamRef.current = stream;

      // Fix: Cast window to `any` to allow access to vendor-prefixed `webkitAudioContext` for broader browser compatibility.
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      // Fix: Cast window to `any` to allow access to vendor-prefixed `webkitAudioContext` for broader browser compatibility.
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      nextStartTimeRef.current = 0;

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

      sessionPromiseRef.current = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            setConnectionState(ConnectionState.CONNECTED);
            const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
            scriptProcessorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
              const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              if (sessionPromiseRef.current) {
                sessionPromiseRef.current.then((session) => {
                    session.sendRealtimeInput({ media: pcmBlob });
                });
              }
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContextRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Fix: Handle transcriptions using refs to avoid stale closures.
            if (message.serverContent?.outputTranscription) {
                const text = message.serverContent.outputTranscription.text;
                currentChaplainTranscriptionRef.current += text;
                setCurrentChaplainTranscription(currentChaplainTranscriptionRef.current);
            }
            if (message.serverContent?.inputTranscription) {
                const text = message.serverContent.inputTranscription.text;
                currentUserTranscriptionRef.current += text;
                setCurrentUserTranscription(currentUserTranscriptionRef.current);
            }
            if (message.serverContent?.turnComplete) {
                const userText = currentUserTranscriptionRef.current.trim();
                const chaplainText = currentChaplainTranscriptionRef.current.trim();
                const newHistory: Transcript[] = [];

                if (userText) {
                    newHistory.push({ speaker: 'user', text: userText });
                }
                if (chaplainText) {
                    newHistory.push({ speaker: 'chaplain', text: chaplainText });
                }

                if (newHistory.length > 0) {
                    setTranscripts(prev => [...prev, ...newHistory]);
                }

                currentUserTranscriptionRef.current = '';
                setCurrentUserTranscription('');
                currentChaplainTranscriptionRef.current = '';
                setCurrentChaplainTranscription('');
            }
            
            // Handle audio playback
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
                setIsSpeaking(true);
                const audioContext = outputAudioContextRef.current!;
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioContext.currentTime);

                const audioBuffer = await decodeAudioData(decode(base64Audio), audioContext, 24000, 1);
                const source = audioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(audioContext.destination);

                source.addEventListener('ended', () => {
                    audioSourcesRef.current.delete(source);
                    if (audioSourcesRef.current.size === 0) {
                        setIsSpeaking(false);
                    }
                });
                
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                audioSourcesRef.current.add(source);
            }

            if (message.serverContent?.interrupted) {
                audioSourcesRef.current.forEach(source => source.stop());
                audioSourcesRef.current.clear();
                setIsSpeaking(false);
                nextStartTimeRef.current = 0;
            }
          },
          onerror: (e: ErrorEvent) => {
            console.error('Connection error:', e);
            setConnectionState(ConnectionState.ERROR);
            cleanup();
          },
          onclose: () => {
            setConnectionState(ConnectionState.CLOSED);
            cleanup();
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
          systemInstruction: "Eres un capellán amigable y sabio para niños. Tu propósito es ofrecer consejos y enseñanzas bíblicas de una manera simple, amorosa y fácil de entender para los niños. Utiliza un lenguaje sencillo, analogías y cuentos cortos de la Biblia. Sé siempre paciente, alentador y positivo. Comienza la conversación saludando al niño y presentándote como su amigo capellán.",
        },
      });
    } catch (error) {
      console.error("Failed to start conversation:", error);
      setConnectionState(ConnectionState.ERROR);
    }
  };

  const isConversationActive = connectionState === ConnectionState.CONNECTED;
  const isListening = isConversationActive && !isSpeaking;

  const TranscriptBubble: React.FC<{ transcript: Transcript }> = ({ transcript }) => (
    <div className={`flex items-start gap-3 my-4 ${transcript.speaker === 'user' ? 'justify-end' : ''}`}>
      {transcript.speaker === 'chaplain' && <ChaplainIcon />}
      <div className={`p-3 rounded-2xl max-w-sm md:max-w-md shadow-md text-gray-800 ${transcript.speaker === 'user' ? 'bg-yellow-200 rounded-br-none' : 'bg-white rounded-bl-none'}`}>
        <p>{transcript.text}</p>
      </div>
      {transcript.speaker === 'user' && <UserIcon />}
    </div>
  );

  return (
    <div className="flex flex-col h-screen font-sans bg-gradient-to-br from-blue-100 to-yellow-100">
      <header className="p-4 bg-white/70 backdrop-blur-sm shadow-md text-center">
        <h1 className="text-2xl font-bold text-blue-800">Consejero Bíblico para Niños</h1>
      </header>
      
      <main ref={transcriptContainerRef} className="flex-1 p-4 overflow-y-auto">
        <div className="max-w-3xl mx-auto">
          {transcripts.length === 0 && connectionState !== ConnectionState.CONNECTING && (
            <div className="text-center text-gray-500 mt-16 flex flex-col items-center">
              <ChaplainIcon />
              <p className="mt-4">¡Hola! Soy tu amigo capellán.</p>
              <p>Presiona el botón de abajo para que conversemos.</p>
            </div>
          )}
          {transcripts.map((t, i) => <TranscriptBubble key={i} transcript={t} />)}
          {currentChaplainTranscription && <TranscriptBubble transcript={{ speaker: 'chaplain', text: currentChaplainTranscription + '...' }} />}
          {currentUserTranscription && <TranscriptBubble transcript={{ speaker: 'user', text: currentUserTranscription + '...' }} />}
        </div>
      </main>

      <footer className="p-4 bg-white/70 backdrop-blur-sm shadow-inner">
        <div className="max-w-3xl mx-auto flex flex-col items-center gap-4">
          <StatusIndicator state={connectionState} isSpeaking={isSpeaking} isListening={isListening} />
          <button
            onClick={handleToggleConversation}
            disabled={connectionState === ConnectionState.CONNECTING}
            className={`w-20 h-20 rounded-full flex items-center justify-center text-white shadow-lg transition-all duration-300 focus:outline-none focus:ring-4 focus:ring-opacity-50
              ${isConversationActive ? 'bg-red-500 hover:bg-red-600 focus:ring-red-300' : 'bg-green-500 hover:bg-green-600 focus:ring-green-300'}
              ${connectionState === ConnectionState.CONNECTING ? 'bg-gray-400 cursor-not-allowed animate-pulse' : ''}`}
          >
            {isConversationActive ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1zm4 0a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            )}
          </button>
        </div>
      </footer>
    </div>
  );
};

export default App;
