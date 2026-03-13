from .decorator import trickle
from .transport import configure
from .instrument import instrument, instrument_fastapi, instrument_flask, instrument_django
from .observe import observe, observe_fn
from .progress import progress

__all__ = [
    "trickle",
    "configure",
    "instrument",
    "instrument_fastapi",
    "instrument_flask",
    "instrument_django",
    "observe",
    "observe_fn",
    "progress",
]


# IPython extension entry point: %load_ext trickle
def load_ipython_extension(ipython):  # type: ignore
    """Called by IPython when ``%load_ext trickle`` is executed."""
    from .notebook import load_ipython_extension as _load
    _load(ipython)


def unload_ipython_extension(ipython):  # type: ignore
    """Called by IPython when ``%unload_ext trickle`` is executed."""
    from .notebook import unload_ipython_extension as _unload
    _unload(ipython)
