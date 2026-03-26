const VOTER_ID_KEY = "votelive_voter_id"
const VOTER_NAME_KEY = "votelive_voter_name"

export function getVoterId() {
  let id = localStorage.getItem(VOTER_ID_KEY)
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36)
    localStorage.setItem(VOTER_ID_KEY, id)
  }
  return id
}

export function getVoterName() {
  return localStorage.getItem(VOTER_NAME_KEY) || ""
}

export function setVoterName(name) {
  localStorage.setItem(VOTER_NAME_KEY, name)
}
