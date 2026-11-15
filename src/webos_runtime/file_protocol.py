"""Public, state-free account-file wire contract shared by issuer and storage."""
import base64
from importlib.resources import files
import json
import re
from types import MappingProxyType
from urllib.parse import urlsplit

CONTRACT = MappingProxyType(json.loads(files(__package__).joinpath('account_files.json').read_text()))
CONFIRMATION_TYPE = CONTRACT['confirmationType']
USE_TYPE = CONTRACT['useType']
AUTHORIZE = CONTRACT['authorizePath']
CHALLENGE = CONTRACT['challengePath']
LIFETIME = CONTRACT['grantLifetimeSeconds']


def gateway_context(origin, base_path=''):
    parsed = urlsplit(origin)
    if not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment or origin != parsed.geturl() or (parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname == '127.0.0.1')):
        raise ValueError('Explicit HTTPS or loopback gateway origin required')
    if not isinstance(base_path, str) or base_path and not re.fullmatch(r'(?:/[A-Za-z0-9_-]+)+', base_path):
        raise ValueError('Canonical gateway mount required')
    return origin + base_path + '/gateway', base_path + '/gateway/use'


def canonical_digest(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', value):
        raise ValueError('Canonical SHA256 digest required')
    raw = base64.urlsafe_b64decode(value + '=')
    if len(raw) != 32 or base64.urlsafe_b64encode(raw).rstrip(b'=').decode('ascii') != value:
        raise ValueError('Canonical SHA256 digest required')
    return value
