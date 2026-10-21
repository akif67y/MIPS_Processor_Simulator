import { useEffect, useState, type ComponentType } from 'react'
import { PcUpdate } from './lessons/PcUpdate'
import { DatapathWalk } from './lessons/DatapathWalk'
import { AddBne } from './lessons/AddBne'
import { ExtensionPage, type ExtensionSpec } from './lessons/ExtensionPage'
import { JAL, JR, LUI, ORI, SLT } from './lessons/extensions'
import { Forwarding } from './lessons/Forwarding'
import { PipelineLab } from './lessons/PipelineLab'

const ext = (spec: ExtensionSpec) => () => <ExtensionPage spec={spec} />

// One page per lesson, addressed by the URL hash (e.g. #/datapath).
const PAGES: { path: string; title: string; Page: ComponentType }[] = [
  { path: 'pc-update', title: 'Next PC', Page: PcUpdate },
  { path: 'datapath', title: 'Datapath walk', Page: DatapathWalk },
  { path: 'add-bne', title: '+ bne', Page: AddBne },
  { path: 'add-jr', title: '+ jr', Page: ext(JR) },
  { path: 'add-jal', title: '+ jal', Page: ext(JAL) },
  { path: 'add-lui', title: '+ lui', Page: ext(LUI) },
  { path: 'add-ori', title: '+ ori', Page: ext(ORI) },
  { path: 'slt', title: 'slt', Page: ext(SLT) },
  { path: 'forwarding', title: 'Forwarding', Page: Forwarding },
  { path: 'pipeline-lab', title: 'Pipeline lab', Page: PipelineLab },
]

function currentPath() {
  return window.location.hash.replace(/^#\/?/, '')
}

export default function App() {
  const [path, setPath] = useState(currentPath)

  useEffect(() => {
    const onHash = () => {
      setPath(currentPath())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const page = PAGES.find((p) => p.path === path) ?? PAGES[0]

  return (
    <>
      <nav className="topnav">
        <span className="brand">CSE 209 Lab</span>
        {PAGES.map((p) => (
          <a key={p.path} href={`#/${p.path}`} className={p === page ? 'on' : ''}>
            {p.title}
          </a>
        ))}
      </nav>
      <page.Page key={page.path} />
    </>
  )
}
