import { render } from 'sigx';
import '@sigx/zero/css';
import '@sigx/richtext-zero/css';
import { App } from './App';
import './showcase.css';

render(<App />, document.getElementById('app')!);
