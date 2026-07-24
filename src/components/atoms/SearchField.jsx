function SearchField({ value, onChange }) {
  return (
    <label className="atom-search-field" aria-label="Search transactions">
      <span className="atom-search-icon" aria-hidden="true" />
      <input
        className="atom-search-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search anything"
      />
    </label>
  )
}

export default SearchField
