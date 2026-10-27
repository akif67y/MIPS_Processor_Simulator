import { useEffect, useState, type ComponentType } from 'react'
import { PcUpdate } from './lessons/PcUpdate'
import { DatapathWalk } from './lessons/DatapathWalk'
import { AddBne } from './lessons/AddBne'
import { ExtensionPage, type ExtensionSpec } from './lessons/ExtensionPage'
import { JAL, JR, LUI, ORI, SLT } from './lessons/extensions'
import { Forwarding } from './lessons/Forwarding'
import { ControlHazardLab, DataHazardLab } from './lessons/Studio'
import { NAV } from './nav'
import { BranchPrediction } from './lessons/BranchPrediction'
import { Home } from './home/Home'

const ext = (spec: ExtensionSpec) => () => <ExtensionPage spec={spec} />

// One page per lesson, addressed by the URL hash (e.g. #/datapath). Titles and order come from NAV.
// #/ and any other address open the home page.
const VIEWS: Record<string, ComponentType> = {
  'pc-update': PcUpdate,
  datapath: DatapathWalk,
  'add-bne': AddBne,
  'add-jr': ext(JR),
  'add-jal': ext(JAL),
  'add-lui': ext(LUI),
  'add-ori': ext(ORI),
  slt: ext(SLT),
  forwarding: Forwarding,
  'data-hazards': DataHazardLab,
  'control-hazards': ControlHazardLab,
  'branch-prediction': BranchPrediction,
}
const PAGES = NAV.map((n) => ({ ...n, Page: VIEWS[n.path] }))

// Old addresses that still work.
const ALIASES: Record<string, string> = { 'pipeline-lab': 'data-hazards' }

function currentPath() {
  const p = window.location.hash.replace(/^#\/?/, '')
  return ALIASES[p] ?? p
}

export default function App() {
  const [path, setPath] = useState(currentPath)

  useEffect(() => {
    const onHash = () => {
      setPath(currentPath())
      // A home-page section link (#labs) scrolls to its section; anything else starts at the top.
      if (!document.getElementById(window.location.hash.slice(1))) window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const page = PAGES.find((p) => p.path === path)
  if (!page) return <Home />

  return (
    <>
      <nav className="topnav">
        <a className="brand" href="#/">CSE 209 Lab</a>
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
