'use client';
import { useState, useEffect, useRef, ChangeEvent } from "react";
import axios from "axios";

const UploadIcon = () => (
  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
  </svg>
);

interface Concept {
  titulo: string;
  definicion: string;
}

export default function Page() {
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  
  const [renderTrigger, setRenderTrigger] = useState(0); 

  const gameState = useRef({
    gameIndex: 0,
    wordIndex: 0,
    typedWord: "",
    typedHistory: [] as string[],
    concepts: [] as Concept[],
    isPlaying: false
  });

  const forceUpdate = () => setRenderTrigger(prev => prev + 1);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isLoading) {
      setUploadProgress(0);
      interval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 90) return 90;
          return prev + (prev < 50 ? 5 : 2);
        });
      }, 500);
    } else {
      setUploadProgress(100);
    }
    return () => clearInterval(interval);
  }, [isLoading]);

  const handleFileChange = async (evento: ChangeEvent<HTMLInputElement>) => {
    try {
      const file = evento.target.files?.[0];
      if (!file) return;

      setIsLoading(true);
      setError(null);
      
      gameState.current = {
        gameIndex: 0,
        wordIndex: 0,
        typedWord: "",
        typedHistory: [],
        concepts: [],
        isPlaying: false
      };
      setConcepts([]); 
      
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await axios.post(process.env.NEXT_PUBLIC_API_URL + '/api/analizar', formData);
      const receivedConcepts = response.data.concepts || [];
      
      if (receivedConcepts.length === 0) {
        setError("No concepts found. The AI returned an empty list.");
      } else {
        gameState.current.concepts = receivedConcepts;
        gameState.current.isPlaying = true;
        setConcepts(receivedConcepts);
      }

    } catch (err) {
      console.error(err);
      setError("Error connecting to backend.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const handleKeyDown = (evento: KeyboardEvent) => {
      const state = gameState.current;

      if (!state.isPlaying || state.concepts.length === 0 || state.gameIndex >= state.concepts.length) return;

      const currentConcept = state.concepts[state.gameIndex];
      if (!currentConcept?.definicion) return;

      const words = currentConcept.definicion.split(' ').filter(Boolean);
      const currentWord = words[state.wordIndex];

      if (!currentWord) return;

      if (evento.key === ' ' || evento.key === 'Enter') {
        evento.preventDefault();
        if (state.typedWord === "") return; 

        state.typedHistory.push(state.typedWord); 
        
        const nextWordIndex = state.wordIndex + 1;

        if (nextWordIndex >= words.length) {
          state.gameIndex++;
          state.wordIndex = 0;
          state.typedHistory = [];
        } else {
          state.wordIndex = nextWordIndex;
        }
        state.typedWord = ""; 
        
        forceUpdate();
        return;
      }

      if (evento.key === 'Backspace') {
        evento.preventDefault();
        state.typedWord = state.typedWord.slice(0, -1);
        forceUpdate();
        return;
      }

      if (evento.key.length === 1) {
        evento.preventDefault();
        if (state.typedWord.length > currentWord.length + 10) return;
        
        state.typedWord += evento.key;
        forceUpdate();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []); 

  const state = gameState.current;
  const gameProgress = concepts.length > 0 ? (state.gameIndex / concepts.length) * 100 : 0;
  const currentConcept = concepts[state.gameIndex];
  const currentWords = currentConcept?.definicion?.split(' ').filter(Boolean) || [];

  return (
    <main className="flex min-h-screen flex-col items-center p-8 md:p-16 bg-slate-100 text-slate-800 font-sans">
      <h1 className="text-5xl font-extrabold mb-8 bg-gradient-to-r from-blue-600 to-indigo-700 bg-clip-text text-transparent">
        TypeFast AI
      </h1>
      
      <label className={`mb-6 cursor-pointer inline-flex items-center px-6 py-3 bg-white text-blue-600 font-semibold rounded-lg shadow-md border border-slate-200 hover:bg-slate-50 transition-colors ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}>
        <UploadIcon />
        <span>{concepts.length > 0 ? "Upload new file" : "Upload a file to start"}</span>
        <input 
          type="file" 
          onChange={handleFileChange} 
          accept=".txt,.pdf,.docx" 
          className="hidden" 
          disabled={isLoading}
        />
      </label>

      {isLoading && (
        <div className="w-full max-w-md mt-4 p-4 bg-white rounded-xl shadow-sm border border-slate-200">
            <div className="flex justify-between mb-2">
                <span className="text-sm font-medium text-slate-700">Analyzing...</span>
                <span className="text-sm font-medium text-blue-600">{uploadProgress}%</span>
            </div>
            <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-500 ease-out" style={{ width: `${uploadProgress}%` }}></div>
            </div>
        </div>
      )}

      {error && (
        <div className="w-full max-w-md text-center text-red-600 bg-red-100 p-4 rounded-lg mt-4 border border-red-200">
          <strong>Oops!</strong> {error}
        </div>
      )}

      {!isLoading && concepts.length > 0 && state.gameIndex < concepts.length && (
        <div className="w-full max-w-4xl animate-in fade-in duration-500">
          <h2 className="text-3xl font-bold mt-4 mb-6 text-slate-800 text-center">
            {currentConcept.titulo}
          </h2>

          <div className="w-full p-8 bg-white shadow-xl rounded-xl border border-slate-200 font-mono text-3xl leading-relaxed tracking-wide">
            {currentWords.map((word, p_idx) => (
              <span key={p_idx} className="mr-4 inline-block mb-2">
                {word.split('').map((letter, l_idx) => {
                  let className = "text-slate-300"; 

                  if (p_idx === state.wordIndex) {
                    const typedLetter = state.typedWord[l_idx];
                    if (typedLetter === letter) className = "text-green-600 font-bold"; 
                    else if (typedLetter !== undefined) className = "text-red-500 bg-red-100 rounded-sm"; 
                    else className = "text-slate-800"; 
                    
                    if (l_idx === state.typedWord.length) className += " border-l-2 border-blue-500 animate-pulse";
                  
                  } else if (p_idx < state.wordIndex) {
                    const savedWord = state.typedHistory[p_idx];
                    const savedLetter = savedWord?.[l_idx];
                    if (savedLetter === letter) className = "text-green-600 font-medium opacity-60";
                    else className = "text-red-400 bg-red-50 opacity-60";
                  }
                  return <span key={l_idx} className={className}>{letter}</span>;
                })}
                
                {p_idx === state.wordIndex && state.typedWord.length > word.length && (
                  <span className="text-red-500 bg-red-100 rounded-sm opacity-80">
                    {state.typedWord.slice(word.length)}
                  </span>
                )}
              </span>
            ))}
          </div>
          
          <div className="w-full mt-8">
            <div className="flex justify-between text-sm text-slate-500 mb-2">
               <span>Progress</span>
               <span>{state.gameIndex + 1} / {concepts.length}</span>
            </div>
            <div className="w-full bg-slate-200 h-3 rounded-full overflow-hidden">
              <div className="bg-green-500 h-3 transition-all duration-500 ease-out" style={{ width: `${gameProgress}%` }}></div>
            </div>
          </div>
        </div>
      )}

      {!isLoading && concepts.length > 0 && state.gameIndex >= concepts.length && (
        <div className="text-center mt-12 p-10 bg-white shadow-2xl rounded-2xl border border-green-100 animate-in zoom-in duration-500">
          <div className="text-7xl mb-6">🏆</div>
          <p className="text-4xl font-extrabold text-slate-800 mb-2">All Done!</p>
          <p className="text-xl text-slate-500 mb-8">You've mastered all the concepts.</p>
          <button 
            onClick={() => window.location.reload()} 
            className="px-8 py-3 bg-blue-600 text-white font-bold rounded-full hover:bg-blue-700 transition shadow-lg hover:shadow-xl transform hover:-translate-y-1"
          >
            Upload Another
          </button>
        </div>
      )}
    </main>
  );
}