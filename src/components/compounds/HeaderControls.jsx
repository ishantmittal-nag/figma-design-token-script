import SearchField from '../atoms/SearchField'

function HeaderControls({ searchValue, onSearchChange }) {
  return (
    <header className="compound-header-controls">
      <div className="header-title-block">
        <h1>Good morning, Ishant</h1>
        <p>Here&apos;s what&apos;s happening with your money today.</p>
      </div>

      <div className="header-actions">
        <SearchField value={searchValue} onChange={onSearchChange} />
        <div className="atom-avatar" aria-label="Profile initials">
          IM
        </div>
      </div>
    </header>
  )
}

export default HeaderControls
