import json
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import CfAccount, CfAccountPic, CfZone, Domain, Pic, PicTeam, Server, ServerPic, ServerPicTeam

SEED_PIC_CODES = ["CHAT", "TIMM", "QUICK", "CREW", "BANG", "VIN", "PII", "RUP", "SOP", "COS", "ARM", "PUN", "OVN"]

# do-sgp1-03 runs internal tools/webapps, not WordPress sites - it has no
# domains to plan by PIC, so it's excluded from the "chưa gán" review queue
# instead of sitting there forever with nothing to assign.
NON_PIC_SERVERS = {"do-sgp1-03"}

# OVN is the one PIC that subdivides into teams; seeded once at startup.
SEED_PIC_TEAMS = {
    "OVN": {
        "Team 1": ["Lyly", "Pakadot", "Kane", "Ruler", "Bunny", "Suri"],
        "Team 2": ["Travis", "Zamo"],
    }
}

# Known server -> (PIC, [team names]) facts, applied once as a gap-fill (only
# when the server has no PIC assigned yet) so a later manual edit via the UI
# is never clobbered on restart.
SEED_SERVER_PIC_TEAMS = {
    "ali-ovn-team1-martechs-g-brands": ("OVN", ["Team 1"]),
    "gcp-ovn-team1-brandg-01": ("OVN", ["Team 1"]),
    "ali-ovn-team2-martechs-g-brands": ("OVN", ["Team 2"]),
    "gcp-ovn-team2-brandg-01": ("OVN", ["Team 2"]),
    "gcp-ovn-team1-dts-01": ("OVN", ["Team 1", "Team 2"]),
    "gcp-pun-01": ("PUN", []),
}


def seed_pics(db: Session) -> None:
    existing = {p.code for p in db.execute(select(Pic)).scalars().all()}
    for code in SEED_PIC_CODES:
        if code not in existing:
            db.add(Pic(code=code))
    db.commit()


def seed_pic_teams(db: Session) -> None:
    code_to_id, _ = _pic_maps(db)
    existing = {(t.pic_id, t.name) for t in db.execute(select(PicTeam)).scalars().all()}
    for pic_code, teams in SEED_PIC_TEAMS.items():
        pic_id = code_to_id.get(pic_code)
        if not pic_id:
            continue
        for name, members in teams.items():
            if (pic_id, name) in existing:
                continue
            db.add(PicTeam(pic_id=pic_id, name=name, members=json.dumps(members)))
    db.commit()


def seed_known_server_pics(db: Session) -> None:
    code_to_id, _ = _pic_maps(db)
    team_ids_by_pic_and_name = {
        (t.pic_id, t.name): t.id for t in db.execute(select(PicTeam)).scalars().all()
    }
    assigned_servers = {r[0] for r in db.execute(select(ServerPic.server_name).distinct())}
    for server_name, (pic_code, team_names) in SEED_SERVER_PIC_TEAMS.items():
        if server_name in assigned_servers:
            continue
        pic_id = code_to_id.get(pic_code)
        if not pic_id:
            continue
        db.add(ServerPic(server_name=server_name, pic_id=pic_id))
        for team_name in team_names:
            team_id = team_ids_by_pic_and_name.get((pic_id, team_name))
            if team_id:
                db.add(ServerPicTeam(server_name=server_name, team_id=team_id))
    db.commit()


def _pic_maps(db: Session) -> tuple[dict[str, int], dict[int, str]]:
    pics = db.execute(select(Pic)).scalars().all()
    code_to_id = {p.code: p.id for p in pics}
    id_to_code = {p.id: p.code for p in pics}
    return code_to_id, id_to_code


def _extract_pic_codes(text: str, codes: list[str]) -> list[str]:
    if not text:
        return []
    t = text.upper()
    return [c for c in codes if c in t]


def suggest_pics(db: Session) -> dict:
    """Fills in PIC guesses ONLY for servers/accounts that currently have
    zero PIC assignments - never touches something a human already set, so
    it's safe to re-run any time (e.g. after a fresh CF discovery adds new
    accounts)."""
    code_to_id, _ = _pic_maps(db)
    codes = list(code_to_id.keys())

    assigned_servers = {r[0] for r in db.execute(select(ServerPic.server_name).distinct())}
    servers = db.execute(select(Server.server_name)).scalars().all()
    new_server_links = 0
    for name in servers:
        if name in assigned_servers:
            continue
        matches = _extract_pic_codes(name, codes)
        for c in matches:
            db.add(ServerPic(server_name=name, pic_id=code_to_id[c]))
            new_server_links += 1

    assigned_accounts = {r[0] for r in db.execute(select(CfAccountPic.account_id).distinct())}
    accounts = db.execute(select(CfAccount.id, CfAccount.label)).all()
    new_account_links = 0
    for account_id, label in accounts:
        if account_id in assigned_accounts:
            continue
        matches = _extract_pic_codes(label, codes)
        for c in matches:
            db.add(CfAccountPic(account_id=account_id, pic_id=code_to_id[c]))
            new_account_links += 1

    db.commit()
    return {"new_server_links": new_server_links, "new_account_links": new_account_links}


def get_server_pics_map(db: Session) -> dict[str, list[str]]:
    _, id_to_code = _pic_maps(db)
    out: dict[str, list[str]] = {}
    for server_name, pic_id in db.execute(select(ServerPic.server_name, ServerPic.pic_id)).all():
        out.setdefault(server_name, []).append(id_to_code.get(pic_id, "?"))
    return out


def get_account_pics_map(db: Session) -> dict[int, list[str]]:
    _, id_to_code = _pic_maps(db)
    out: dict[int, list[str]] = {}
    for account_id, pic_id in db.execute(select(CfAccountPic.account_id, CfAccountPic.pic_id)).all():
        out.setdefault(account_id, []).append(id_to_code.get(pic_id, "?"))
    return out


def list_pic_teams(db: Session) -> list[dict]:
    _, id_to_code = _pic_maps(db)
    teams = db.execute(select(PicTeam)).scalars().all()
    return [
        {
            "id": t.id,
            "pic": id_to_code.get(t.pic_id, "?"),
            "name": t.name,
            "members": json.loads(t.members or "[]"),
        }
        for t in teams
    ]


def get_server_teams_map(db: Session) -> dict[str, list[str]]:
    teams_by_id = {t.id: t for t in db.execute(select(PicTeam)).scalars().all()}
    _, id_to_code = _pic_maps(db)
    out: dict[str, list[str]] = {}
    for server_name, team_id in db.execute(select(ServerPicTeam.server_name, ServerPicTeam.team_id)).all():
        team = teams_by_id.get(team_id)
        if not team:
            continue
        pic_code = id_to_code.get(team.pic_id, "?")
        out.setdefault(server_name, []).append(f"{pic_code}/{team.name}")
    return out


def set_server_teams(db: Session, server_name: str, team_ids: list[int]) -> list[int]:
    """Also ensures the server carries the PIC each team belongs to
    (additive - never removes a PIC the server already has)."""
    teams_by_id = {t.id: t for t in db.execute(select(PicTeam)).scalars().all()}
    unknown = [tid for tid in team_ids if tid not in teams_by_id]
    if unknown:
        raise ValueError(f"unknown team id(s): {', '.join(str(t) for t in unknown)}")

    db.query(ServerPicTeam).filter(ServerPicTeam.server_name == server_name).delete()
    for tid in team_ids:
        db.add(ServerPicTeam(server_name=server_name, team_id=tid))

    existing_pic_ids = {
        r[0] for r in db.execute(select(ServerPic.pic_id).where(ServerPic.server_name == server_name))
    }
    for tid in team_ids:
        pic_id = teams_by_id[tid].pic_id
        if pic_id not in existing_pic_ids:
            db.add(ServerPic(server_name=server_name, pic_id=pic_id))
            existing_pic_ids.add(pic_id)

    db.commit()
    return team_ids


def set_server_pics(db: Session, server_name: str, codes: list[str]) -> list[str]:
    code_to_id, _ = _pic_maps(db)
    unknown = [c for c in codes if c not in code_to_id]
    if unknown:
        raise ValueError(f"unknown PIC code(s): {', '.join(unknown)}")
    db.query(ServerPic).filter(ServerPic.server_name == server_name).delete()
    for c in codes:
        db.add(ServerPic(server_name=server_name, pic_id=code_to_id[c]))
    db.commit()
    return codes


def set_account_pics(db: Session, account_id: int, codes: list[str]) -> list[str]:
    code_to_id, _ = _pic_maps(db)
    unknown = [c for c in codes if c not in code_to_id]
    if unknown:
        raise ValueError(f"unknown PIC code(s): {', '.join(unknown)}")
    db.query(CfAccountPic).filter(CfAccountPic.account_id == account_id).delete()
    for c in codes:
        db.add(CfAccountPic(account_id=account_id, pic_id=code_to_id[c]))
    db.commit()
    return codes


def pic_summary(db: Session) -> list[dict]:
    pics = db.execute(select(Pic)).scalars().all()
    server_pics = get_server_pics_map(db)
    account_pics = get_account_pics_map(db)

    domain_rows = db.execute(select(Domain.domain, Domain.server_name)).all()
    domains_by_server: dict[str, set[str]] = {}
    for domain, server_name in domain_rows:
        domains_by_server.setdefault(server_name, set()).add(domain)

    accounts_by_id = {a.id: a for a in db.execute(select(CfAccount)).scalars().all()}
    zone_count_by_account = {a.id: a.zone_count for a in accounts_by_id.values()}

    out = []
    for pic in pics:
        servers_of_pic = [s for s, codes in server_pics.items() if pic.code in codes]
        accounts_of_pic = [aid for aid, codes in account_pics.items() if pic.code in codes]
        domains_of_pic: set[str] = set()
        for s in servers_of_pic:
            domains_of_pic |= domains_by_server.get(s, set())
        zone_total = sum(zone_count_by_account.get(aid, 0) for aid in accounts_of_pic)
        out.append(
            {
                "pic": pic.code,
                "server_count": len(servers_of_pic),
                "domain_count": len(domains_of_pic),
                "cf_account_count": len(accounts_of_pic),
                "zone_count": zone_total,
            }
        )
    return out


def unassigned(db: Session) -> dict:
    server_pics = get_server_pics_map(db)
    account_pics = get_account_pics_map(db)
    servers = db.execute(select(Server.server_name, Server.ip)).all()
    accounts = db.execute(select(CfAccount.id, CfAccount.label, CfAccount.email)).all()
    return {
        "servers": [
            {"server_name": s, "ip": ip}
            for s, ip in servers
            if s not in server_pics and s not in NON_PIC_SERVERS
        ],
        "accounts": [
            {"id": aid, "label": label, "email": email}
            for aid, label, email in accounts
            if aid not in account_pics
        ],
    }


def mismatched_domains(db: Session) -> list[dict]:
    """Domains hosted on a server tied to PIC set A, whose Cloudflare zone
    sits in an account tied to PIC set B, where A and B are both non-empty
    and disjoint - i.e. a domain that's provably in the wrong account
    relative to who owns its hosting server."""
    server_pics = get_server_pics_map(db)
    account_pics = get_account_pics_map(db)
    accounts_by_id = {a.id: a for a in db.execute(select(CfAccount)).scalars().all()}

    domain_rows = db.execute(select(Domain.domain, Domain.server_name)).all()
    domain_servers: dict[str, list[str]] = {}
    for domain, server_name in domain_rows:
        domain_servers.setdefault(domain, []).append(server_name)

    zone_rows = db.execute(select(CfZone.domain, CfZone.account_id)).all()
    domain_accounts: dict[str, list[int]] = {}
    for domain, account_id in zone_rows:
        domain_accounts.setdefault(domain, []).append(account_id)

    out = []
    for domain, servers in domain_servers.items():
        account_ids = domain_accounts.get(domain)
        if not account_ids:
            continue
        server_pic_set: set[str] = set()
        for s in servers:
            server_pic_set.update(server_pics.get(s, []))
        account_pic_set: set[str] = set()
        for aid in account_ids:
            account_pic_set.update(account_pics.get(aid, []))
        if not server_pic_set or not account_pic_set:
            continue
        if server_pic_set & account_pic_set:
            continue
        out.append(
            {
                "domain": domain,
                "server_name": servers[0],
                "server_pics": sorted(server_pic_set),
                "cf_account_label": accounts_by_id[account_ids[0]].label if account_ids[0] in accounts_by_id else None,
                "cf_account_id": account_ids[0],
                "cf_account_pics": sorted(account_pic_set),
            }
        )
    out.sort(key=lambda r: r["domain"])
    return out


UNASSIGNED = "__unassigned__"  # sentinel `pic` filter value meaning "has no PIC at all"


def server_names_for_pic(db: Session, pic_code: str) -> set[str]:
    if pic_code == UNASSIGNED:
        assigned = {r[0] for r in db.execute(select(ServerPic.server_name).distinct())}
        all_servers = {r[0] for r in db.execute(select(Server.server_name))}
        return (all_servers - assigned) - NON_PIC_SERVERS
    code_to_id, _ = _pic_maps(db)
    pic_id = code_to_id.get(pic_code)
    if not pic_id:
        return set()
    return {r[0] for r in db.execute(select(ServerPic.server_name).where(ServerPic.pic_id == pic_id))}


def account_ids_for_pic(db: Session, pic_code: str) -> set[int]:
    if pic_code == UNASSIGNED:
        assigned = {r[0] for r in db.execute(select(CfAccountPic.account_id).distinct())}
        all_accounts = {r[0] for r in db.execute(select(CfAccount.id))}
        return all_accounts - assigned
    code_to_id, _ = _pic_maps(db)
    pic_id = code_to_id.get(pic_code)
    if not pic_id:
        return set()
    return {r[0] for r in db.execute(select(CfAccountPic.account_id).where(CfAccountPic.pic_id == pic_id))}


def suggest_cf_account_for_ip(db: Session, ip: str) -> dict:
    """Used by cf-add: given the target IP of a new domain, find which
    server owns that IP, which PIC(s) that server belongs to, and which
    active CF accounts (in those PICs) are the best fit - least zones
    first, so new domains spread out rather than piling into one account."""
    server = db.execute(select(Server).where(Server.ip == ip)).scalars().first()
    if not server:
        return {"matched_server": None, "pics": [], "candidates": [], "suggested_account_id": None}

    server_pics = get_server_pics_map(db)
    pics = server_pics.get(server.server_name, [])
    if not pics:
        return {"matched_server": server.server_name, "pics": [], "candidates": [], "suggested_account_id": None}

    account_pics = get_account_pics_map(db)
    accounts = db.execute(select(CfAccount).where(CfAccount.is_active.is_(True))).scalars().all()
    candidates = [
        {"id": a.id, "label": a.label, "zone_count": a.zone_count}
        for a in accounts
        if set(account_pics.get(a.id, [])) & set(pics)
    ]
    candidates.sort(key=lambda c: c["zone_count"])
    suggested = candidates[0]["id"] if candidates else None
    return {"matched_server": server.server_name, "pics": pics, "candidates": candidates, "suggested_account_id": suggested}
