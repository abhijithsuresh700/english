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
  const genAI = useRef(null);
  const messagesEndRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const finalTranscriptRef = useRef('');

  useEffect(() => {
    // Initialize Gemini AI
    genAI.current = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);

    // Initialize Speech Recognition
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript + ' ';
          } else {
            interimTranscript += transcript;
          }
        }

        // Accumulate final transcripts
        if (finalTranscript) {
          finalTranscriptRef.current += finalTranscript;

          // Clear any existing timer
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
          }

          // Wait for 2 seconds of silence before sending
          silenceTimerRef.current = setTimeout(() => {
            if (finalTranscriptRef.current.trim()) {
              handleSendMessage(finalTranscriptRef.current.trim());
              finalTranscriptRef.current = '';
              setTranscript('');
            }
          }, 2000);
        }

        // Update display with accumulated final + current interim
        setTranscript(finalTranscriptRef.current + interimTranscript);
      };

      recognitionRef.current.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, corrections]);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);

      // Clear timer and send any remaining text
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
      if (finalTranscriptRef.current.trim()) {
        handleSendMessage(finalTranscriptRef.current.trim());
        finalTranscriptRef.current = '';
      }
      setTranscript('');
    } else {
      recognitionRef.current?.start();
      setIsListening(true);
      setTranscript('');
      finalTranscriptRef.current = '';
    }
  };

  const handleSendMessage = async (text) => {
    if (!text.trim() || isProcessing) return;

    setIsProcessing(true);
    const userMessage = { role: 'user', content: text };
    setMessages(prev => [...prev, userMessage]);
    setTranscript('');

    try {
      const model = genAI.current.getGenerativeModel({
        model: 'gemini-1.5-flash',
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1000,
        }
      });

      const prompt = `You are an English teacher helping a student practice speaking English.
The student just said: "${text}"

Your response should:
1. First, identify any grammar, vocabulary, or pronunciation errors (if any)
2. Provide corrections in a friendly, encouraging way
3. Continue the conversation naturally to keep them practicing
4. Ask a follow-up question to encourage more speaking

IMPORTANT: You must respond with ONLY valid JSON, no markdown formatting, no code blocks.

Format your response as JSON:
{
  "errors": [{"error": "specific error", "correction": "how to fix it", "type": "grammar"}],
  "feedback": "encouraging feedback message",
  "response": "your conversational response",
  "followUp": "a question to continue the conversation"
}

If there are no errors, make the errors array empty but still provide engaging conversation.`;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      console.log('Gemini raw response:', responseText);

      // Try to parse JSON response
      let aiResponse;
      try {
        // Remove markdown code blocks if present
        const cleanedResponse = responseText.replace(/```json\n?|\n?```/g, '').trim();
        console.log('Cleaned response:', cleanedResponse);
        aiResponse = JSON.parse(cleanedResponse);
      } catch (e) {
        console.error('JSON parsing failed:', e);
        // Fallback if JSON parsing fails
        aiResponse = {
          errors: [],
          feedback: '',
          response: responseText,
          followUp: ''
        };
      }

      // Add AI message
      const assistantMessage = {
        role: 'assistant',
        content: `${aiResponse.feedback ? aiResponse.feedback + '\n\n' : ''}${aiResponse.response}${aiResponse.followUp ? '\n\n' + aiResponse.followUp : ''}`
      };
      setMessages(prev => [...prev, assistantMessage]);

      // Add corrections if any
      if (aiResponse.errors && aiResponse.errors.length > 0) {
        setCorrections(prev => [...prev, {
          userText: text,
          errors: aiResponse.errors,
          timestamp: new Date().toLocaleTimeString()
        }]);
      }

      // Speak the response
      speakText(assistantMessage.content);

    } catch (error) {
      console.error('Error calling Gemini API:', error);
      console.error('Error details:', error.message);
      console.error('Full error:', JSON.stringify(error, null, 2));

      const errorMessage = {
        role: 'assistant',
        content: `Sorry, I encountered an error: ${error.message || 'Please try again.'}`
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsProcessing(false);
    }
  };

  const speakText = (text) => {
    if ('speechSynthesis' in window) {
      // Cancel any ongoing speech
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.9;
      utterance.pitch = 1;

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      window.speechSynthesis.speak(utterance);
    }
  };

  const clearHistory = () => {
    setMessages([]);
    setCorrections([]);
  };

  return (
    <div className="voice-chat-container">
      <div className="chat-header">
        <h1>English Learning Assistant</h1>
        <p>Practice speaking English and get real-time feedback</p>
      </div>

      <div className="main-content">
        <div className="chat-section">
          <div className="messages-container">
            {messages.length === 0 ? (
              <div className="welcome-message">
                <h2>Welcome!</h2>
                <p>Click the microphone button and start speaking in English.</p>
                <p>I'll help you improve your grammar, vocabulary, and pronunciation.</p>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div key={idx} className={`message ${msg.role}`}>
                  <div className="message-content">
                    <strong>{msg.role === 'user' ? 'You' : 'Teacher'}:</strong>
                    <p>{msg.content}</p>
                  </div>
                </div>
              ))
            )}
            {isProcessing && (
              <div className="message assistant">
                <div className="message-content">
                  <strong>Teacher:</strong>
                  <p className="typing-indicator">Thinking...</p>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="input-section">
            <div className="transcript-display">
              {transcript && <p><em>{transcript}</em></p>}
            </div>
            <div className="controls">
              <button
                className={`mic-button ${isListening ? 'listening' : ''}`}
                onClick={toggleListening}
                disabled={isProcessing}
              >
                <span className="mic-icon">{isListening ? '⏸️' : '🎤'}</span>
                <span>{isListening ? 'Stop Recording' : 'Start Speaking'}</span>
              </button>
              {messages.length > 0 && (
                <button className="clear-button" onClick={clearHistory}>
                  Clear History
                </button>
              )}
            </div>
            {isSpeaking && <div className="speaking-indicator">🔊 Speaking...</div>}
          </div>
        </div>

        <div className="corrections-section">
          <h3>Corrections & Feedback</h3>
          {corrections.length === 0 ? (
            <div className="no-corrections">
              <p>Your corrections will appear here</p>
            </div>
          ) : (
            <div className="corrections-list">
              {corrections.map((correction, idx) => (
                <div key={idx} className="correction-item">
                  <div className="correction-header">
                    <span className="time">{correction.timestamp}</span>
                  </div>
                  <div className="user-text">
                    <strong>You said:</strong> "{correction.userText}"
                  </div>
                  <div className="errors">
                    {correction.errors.map((error, errorIdx) => (
                      <div key={errorIdx} className={`error-detail ${error.type}`}>
                        <span className="error-type">{error.type}</span>
                        <div className="error-info">
                          <div><strong>Issue:</strong> {error.error}</div>
                          <div><strong>Correction:</strong> {error.correction}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default VoiceChat;
