import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './routes/Home';
import Projects from './routes/Projects';
import Project from './routes/Project';
import NodePage from './routes/NodePage';
import DocsIndex from './routes/DocsIndex';
import Doc from './routes/Doc';
import Search from './routes/Search';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/p/:slug" element={<Project />} />
        <Route path="/i/:id" element={<NodePage />} />
        <Route path="/docs" element={<DocsIndex />} />
        <Route path="/docs/*" element={<Doc />} />
        <Route path="/search" element={<Search />} />
      </Route>
    </Routes>
  );
}
