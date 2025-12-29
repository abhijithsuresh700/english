import { useState, useEffect, useRef } from 'react';
import { GoogleGenerativeAI } from '@google/generative-ai';

const VoiceChat = () => {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [messages, setMessages] = useState([]);
  const [corrections, setCorrections] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const recognitionRef = useRef(null);
  const genAIRef = useRef(null);
  const modelRef = useRef(null);
  const messagesEndRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const finalTranscriptRef = useRef('');
  const isListeningRef = useRef(false);

  /* ---------------------------- INITIALIZATION ---------------------------- */

  useEffect(() => {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      console.error('VITE_GEMINI_API_KEY is missing');
      return;
    }

    genAIRef.current = new GoogleGenerativeAI(apiKey);

    modelRef.current = genAIRef.current.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: {
        temperature: 0.7,
        responseMimeType: 'application/json',
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUAL_CONTENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    });

    if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new SR();

      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        let interim = '';
        let final = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const t = event.results[i][0].transcript;
          if (event.results[i].isFinal) final += t + ' ';
          else interim += t;
        }

        if (final) {
          finalTranscriptRef.current += final;
          clearTimeout(silenceTimerRef.current);

          silenceTimerRef.current = setTimeout(() => {
            const text = finalTranscriptRef.current.trim();
            if (text.length > 1) handleSendMessage(text);
            finalTranscriptRef.current = '';
            setTranscript('');
          }, 2000);
        }

        setTranscript(finalTranscriptRef.current + interim);
      };

      recognition.onerror = (e) => {
        if (e.error !== 'no-speech' && e.error !== 'aborted') {
          console.error('Speech error:', e);
          setIsListening(false);
          isListeningRef.current = false;
        }
      };

      recognition.onend = () => {
        if (isListeningRef.current) {
          try {
            recognition.start();
          } catch {}
        }
      };

      recognitionRef.current = recognition;
    }

    return () => recognitionRef.current?.stop();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, corrections]);

  /* ---------------------------- VOICE CONTROL ---------------------------- */

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      isListeningRef.current = false;
      clearTimeout(silenceTimerRef.current);

      const text = finalTranscriptRef.current.trim();
      if (text.length > 1) handleSendMessage(text);

      finalTranscriptRef.current = '';
      setTranscript('');
    } else {
      recognitionRef.current?.start();
      setIsListening(true);
      isListeningRef.current = true;
      finalTranscriptRef.current = '';
      setTranscript('');
    }
  };

  /* ---------------------------- GEMINI CALL ---------------------------- */

  const handleSendMessage = async (text) => {
    if (!text || text.length < 2 || isProcessing) return;

    setIsProcessing(true);
    setMessages((p) => [...p, { role: 'user', content: text }]);

    const prompt = `
You are an English teacher helping a student practice spoken English.

Student said:
"${text}"

Respond ONLY in valid JSON:

{
  "errors": [
    { "error": "issue", "correction": "fix", "type": "grammar" }
  ],
  "feedback": "encouraging feedback",
  "response": "teacher reply",
  "followUp": "question to continue"
}
`;

    try {
      const result = await modelRef.current.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });

      const raw = result.response.text();
      console.log('Gemini RAW:', raw);

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = {
          errors: [],
          feedback: '',
          response: raw,
          followUp: '',
        };
      }

      const assistantText =
        `${parsed.feedback ? parsed.feedback + '\n\n' : ''}` +
        `${parsed.response}` +
        `${parsed.followUp ? '\n\n' + parsed.followUp : ''}`;

      setMessages((p) => [...p, { role: 'assistant', content: assistantText }]);

      if (parsed.errors?.length) {
        setCorrections((p) => [
          ...p,
          {
            userText: text,
            errors: parsed.errors,
            timestamp: new Date().toLocaleTimeString(),
          },
        ]);
      }

      speakText(assistantText);
    } catch (e) {
      console.error('Gemini error:', e);
      setMessages((p) => [
        ...p,
        {
          role: 'assistant',
          content: 'Teacher is temporarily unavailable. Please try again.',
        },
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  /* ---------------------------- TEXT TO SPEECH ---------------------------- */

  const speakText = (text) => {
    if (!('speechSynthesis' in window)) return;

    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.9;

    u.onstart = () => setIsSpeaking(true);
    u.onend = () => setIsSpeaking(false);
    u.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(u);
  };

  /* ------------------------------- UI ------------------------------- */

  return (
    <div className="voice-chat-container">
      <h1>English Learning Assistant</h1>

      <div className="messages">
        {messages.map((m, i) => (
          <div key={i} className={m.role}>
            <strong>{m.role === 'user' ? 'You' : 'Teacher'}:</strong>
            <p>{m.content}</p>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {transcript && <em>{transcript}</em>}

      <button onClick={toggleListening} disabled={isProcessing}>
        {isListening ? 'Stop Recording' : 'Start Speaking'}
      </button>

      {isSpeaking && <p>Speaking…</p>}
    </div>
  );
};

export default VoiceChat;
