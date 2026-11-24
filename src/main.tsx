import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import NoteWindow from './NoteWindow';
import './styles.css';
import './feature-styles.css';

const isNoteWindow = new URLSearchParams(window.location.search).get('view') === 'note';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isNoteWindow ? <NoteWindow /> : <App />}
  </React.StrictMode>,
);