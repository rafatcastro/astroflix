import { Routes, Route } from 'react-router-dom';
import Library from './pages/Library';
import Course from './pages/Course';
import Lesson from './pages/Lesson';
import Settings from './pages/Settings';
import Flashcards from './pages/Flashcards';
import HelpDrawer from './components/HelpDrawer';
import AvisoAtualizacao from './components/AvisoAtualizacao';
import PortaoConta from './components/PortaoConta';

export default function App() {
  return (
    <>
      <PortaoConta>
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/course/:id" element={<Course />} />
        <Route path="/lesson/:id" element={<Lesson />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/flashcards" element={<Flashcards />} />
      </Routes>
      </PortaoConta>
      {/* Fora das rotas: a ajuda abre por cima de qualquer tela sem desmontar a
          página de trás — quem pede ajuda não perde o lugar onde estava. */}
      <HelpDrawer />
      <AvisoAtualizacao />
    </>
  );
}
