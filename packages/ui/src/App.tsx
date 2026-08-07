import { Navigate, Route, Routes } from 'react-router-dom';
import Gate from './components/Gate';
import Layout from './components/Layout';
import { AccountProvider, useAccount } from './meta';
import { Empty } from './components/bits';
import { lastSpace } from './api';
import Home from './routes/Home';
import Projects from './routes/Projects';
import Project from './routes/Project';
import NodePage from './routes/NodePage';
import DocsIndex from './routes/DocsIndex';
import Doc from './routes/Doc';
import Search from './routes/Search';
import Settings from './routes/Settings';

/** Land in the space you were last in, else your first one. */
function SpaceRedirect() {
  const { spaces, loading } = useAccount();
  if (loading) return null;
  if (!spaces.length) {
    return (
      <div className="content">
        <div className="content-inner">
          <Empty>
            no spaces yet — create one with <code>wake space new "Name"</code>, then reload
          </Empty>
        </div>
      </div>
    );
  }
  const remembered = lastSpace();
  const target = spaces.find((s) => s.slug === remembered) ?? spaces[0];
  return <Navigate to={`/s/${target.slug}`} replace />;
}

export default function App() {
  return (
    <Gate>
      <AccountProvider>
        <Routes>
          <Route path="/" element={<SpaceRedirect />} />
          <Route path="/s/:space" element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="projects" element={<Projects />} />
            <Route path="p/:slug" element={<Project />} />
            <Route path="i/:id" element={<NodePage />} />
            <Route path="docs" element={<DocsIndex />} />
            <Route path="docs/*" element={<Doc />} />
            <Route path="search" element={<Search />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<SpaceRedirect />} />
        </Routes>
      </AccountProvider>
    </Gate>
  );
}
