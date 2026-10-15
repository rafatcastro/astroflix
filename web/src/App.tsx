import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import Library from './pages/Library';
import Course from './pages/Course';
import Lesson from './pages/Lesson';
import Settings from './pages/Settings';
import Flashcards from './pages/Flashcards';
import Pdfs from './pages/Pdfs';
import LeitorPdf from './pages/LeitorPdf';
import Categorias from './pages/Categorias';
import Questoes from './pages/Questoes';
import { caminhoDaCategoria, ultimaCategoria } from './components/CabecalhoCategoria';
import HelpDrawer from './components/HelpDrawer';
import AtualizacaoInicial from './components/AtualizacaoInicial';
import PortaoConta from './components/PortaoConta';

function NaCategoria({ pagina }: { pagina: (cat: string) => JSX.Element }) {
  const { cat = 'sem' } = useParams();
  return pagina(cat);
}

export default function App() {
  return (
    <AtualizacaoInicial>
      <PortaoConta>
      <Routes>
        <Route path="/" element={<Categorias />} />
        {/* Dentro de uma categoria: a key remonta a página ao trocar de categoria. */}
        <Route path="/c/:cat" element={<NaCategoria pagina={(cat) => <Library key={cat} categoria={cat} />} />} />
        <Route path="/c/:cat/pdfs" element={<NaCategoria pagina={(cat) => <Pdfs key={cat} categoria={cat} />} />} />
        <Route path="/c/:cat/questoes" element={<NaCategoria pagina={(cat) => <Questoes key={cat} categoria={cat} />} />} />
        <Route path="/course/:id" element={<Course />} />
        <Route path="/lesson/:id" element={<Lesson />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/flashcards" element={<Flashcards />} />
        <Route path="/pdfs" element={<Navigate to={caminhoDaCategoria(ultimaCategoria(), 'pdfs')} replace />} />
        <Route path="/pdf/:id" element={<LeitorPdf />} />
      </Routes>
      </PortaoConta>
      {/* Fora das rotas: a ajuda abre por cima de qualquer tela sem desmontar a
          página de trás — quem pede ajuda não perde o lugar onde estava. */}
      <HelpDrawer />
    </AtualizacaoInicial>
  );
}
